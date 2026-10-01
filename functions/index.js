const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const { HttpsError, onCall } = require("firebase-functions/v2/https");
const { buildSaleItems, validateSaleRequest } = require("./sale-validation");

initializeApp();

const db = getFirestore();
const REGION = "asia-southeast2";

function saleResponse(sale) {
  return {
    kasir: sale.Kasir,
    items: sale.Items,
    total: sale.Total,
    bayar: sale.Bayar,
    kembalian: sale.Kembalian
  };
}

exports.completeSale = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Silakan login kembali.");
  }

  let saleRequest;
  try {
    saleRequest = validateSaleRequest(request.data || {});
  } catch (error) {
    throw new HttpsError(error.code, error.message);
  }
  const { requestId, payment, quantities } = saleRequest;

  const profileRef = db.collection("pengguna").doc(uid);
  const saleRef = db.collection("penjualan").doc(requestId);

  return db.runTransaction(async (transaction) => {
    const [profileSnap, existingSaleSnap] = await Promise.all([
      transaction.get(profileRef),
      transaction.get(saleRef)
    ]);

    const profile = profileSnap.data();
    if (!profileSnap.exists || profile?.aktif !== true || !["admin", "kasir"].includes(profile?.role)) {
      throw new HttpsError("permission-denied", "Akun tidak aktif atau tidak memiliki akses kasir.");
    }

    if (existingSaleSnap.exists) {
      const existingSale = existingSaleSnap.data();
      if (existingSale.KasirUID !== uid) {
        throw new HttpsError("already-exists", "ID transaksi sudah digunakan.");
      }
      return saleResponse(existingSale);
    }

    const products = Array.from(quantities, ([productId, qty]) => ({
      productId,
      qty,
      ref: db.collection("produk").doc(productId)
    }));
    const productSnapshots = await Promise.all(
      products.map((product) => transaction.get(product.ref))
    );

    let saleDetails;
    try {
      saleDetails = buildSaleItems(products.map((product, index) => ({
        ...product,
        data: productSnapshots[index].exists ? productSnapshots[index].data() : null
      })));
    } catch (error) {
      throw new HttpsError(error.code, error.message);
    }
    const { items, total } = saleDetails;

    if (payment < total) {
      throw new HttpsError("failed-precondition", "Pembayaran kurang dari total terbaru.");
    }

    const sale = {
      Kasir: profile.nama || request.auth.token.email || "Kasir",
      KasirUID: uid,
      Items: items,
      Total: total,
      Bayar: payment,
      Kembalian: payment - total,
      Timestamp: FieldValue.serverTimestamp()
    };

    transaction.create(saleRef, sale);
    for (let index = 0; index < products.length; index += 1) {
      transaction.update(products[index].ref, {
        Stok: productSnapshots[index].data().Stok - products[index].qty
      });
    }

    return saleResponse(sale);
  });
});

exports.deactivateEmployee = onCall({ region: REGION }, async (request) => {
  const callerUid = request.auth?.uid;
  const targetUid = request.data?.uid;
  if (!callerUid) {
    throw new HttpsError("unauthenticated", "Silakan login kembali.");
  }
  if (typeof targetUid !== "string" || targetUid.length === 0 || targetUid === callerUid) {
    throw new HttpsError("invalid-argument", "Pengguna yang dipilih tidak valid.");
  }

  const callerRef = db.collection("pengguna").doc(callerUid);
  const targetRef = db.collection("pengguna").doc(targetUid);
  await db.runTransaction(async (transaction) => {
    const [callerSnap, targetSnap] = await Promise.all([
      transaction.get(callerRef),
      transaction.get(targetRef)
    ]);
    const caller = callerSnap.data();
    if (!callerSnap.exists || caller.aktif !== true || caller.role !== "admin") {
      throw new HttpsError("permission-denied", "Hanya admin aktif yang dapat menonaktifkan pengguna.");
    }
    if (!targetSnap.exists) {
      throw new HttpsError("not-found", "Profil pengguna tidak ditemukan.");
    }
    if (targetSnap.data().aktif !== false) {
      transaction.update(targetRef, {
        aktif: false,
        deactivatedAt: FieldValue.serverTimestamp(),
        deactivatedBy: callerUid
      });
    }
  });

  try {
    await getAuth().updateUser(targetUid, { disabled: true });
  } catch (error) {
    if (error.code !== "auth/user-not-found") {
      throw new HttpsError("internal", "Profil dinonaktifkan, tetapi status Firebase Authentication gagal diperbarui.");
    }
  }

  return { success: true };
});
