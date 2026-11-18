// Photos are kept only in this browser (IndexedDB). Nothing is uploaded.
const DB_NAME = "my365-diary";
const DB_VERSION = 1;

let dbPromise = null;
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("photos")) {
        const s = db.createObjectStore("photos", { keyPath: "id", autoIncrement: true });
        s.createIndex("day", "day");
      }
      if (!db.objectStoreNames.contains("picks")) db.createObjectStore("picks", { keyPath: "day" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function run(storeName, mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const req = fn(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

export const store = {
  allPhotos: () => run("photos", "readonly", s => s.getAll()),
  allPicks: () => run("picks", "readonly", s => s.getAll()),
  addPhoto: photo => run("photos", "readwrite", s => s.add(photo)),
  deletePhoto: id => run("photos", "readwrite", s => s.delete(id)),
  setPick: (day, id) => run("picks", "readwrite", s => s.put({ day, id })),
};

// Ask the browser not to clear our data when storage runs low (best effort).
export async function askPersistentStorage() {
  try {
    if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch (e) { /* not supported: fine */ }
}
