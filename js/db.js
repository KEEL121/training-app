// @ts-check
// db.js — IndexedDBラッパ
// 設計メモ:
// - migrationsはバージョン番号→関数の順次適用形式(将来のスキーマ変更に備える)
// - IndexedDBトランザクションはawaitを跨ぐと自動コミットされるため、
//   インポート用のbulkPutSyncは単一トランザクション内で同期的にputを全発行する
// - 削除は論理削除(deletedAt)が基本。物理削除はGC/初期化のみ

import { nowISO, uuid } from './util.js';

const DB_NAME = 'training-db';
const DB_VERSION = 1;

export const STORES = ['exercises', 'workouts', 'cardio', 'body', 'settings'];

/** @type {Object<number, (db: IDBDatabase, tx: IDBTransaction) => void>} */
const migrations = {
  1: (db) => {
    const ex = db.createObjectStore('exercises', { keyPath: 'id' });
    ex.createIndex('type', 'type');
    ex.createIndex('muscleGroup', 'muscleGroup');

    const w = db.createObjectStore('workouts', { keyPath: 'id' });
    w.createIndex('date', 'date');
    w.createIndex('exerciseId', 'exerciseId');
    w.createIndex('exerciseId_date', ['exerciseId', 'date']);

    const c = db.createObjectStore('cardio', { keyPath: 'id' });
    c.createIndex('date', 'date');
    c.createIndex('exerciseId', 'exerciseId');

    db.createObjectStore('body', { keyPath: 'date' });
    db.createObjectStore('settings', { keyPath: 'key' });
  },
};

/** @type {Promise<IDBDatabase> | null} */
let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      const tx = req.transaction;
      for (let v = (e.oldVersion || 0) + 1; v <= DB_VERSION; v++) {
        if (migrations[v]) migrations[v](db, tx);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // 別タブがDBバージョンを上げた場合: このタブを閉じて更新を促す
      db.onversionchange = () => {
        db.close();
        alert('アプリが更新されました。ページを再読み込みします。');
        location.reload();
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/** リクエスト→Promise変換 */
function reqAsync(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function get(store, key) {
  const db = await openDB();
  return reqAsync(db.transaction(store).objectStore(store).get(key));
}

/** 論理削除済みを除く全件 */
export async function getAll(store, { includeDeleted = false } = {}) {
  const db = await openDB();
  const all = await reqAsync(db.transaction(store).objectStore(store).getAll());
  return includeDeleted ? all : all.filter((r) => !r.deletedAt);
}

export async function getAllByIndex(store, indexName, query, { includeDeleted = false } = {}) {
  const db = await openDB();
  const all = await reqAsync(
    db.transaction(store).objectStore(store).index(indexName).getAll(query),
  );
  return includeDeleted ? all : all.filter((r) => !r.deletedAt);
}

/** put(updatedAtを自動更新) */
export async function put(store, record) {
  const db = await openDB();
  record.updatedAt = nowISO();
  if (!record.createdAt) record.createdAt = record.updatedAt;
  if (!('deletedAt' in record)) record.deletedAt = null;
  await reqAsync(db.transaction(store, 'readwrite').objectStore(store).put(record));
  return record;
}

/** 論理削除(tombstone)。マージで削除が伝播する */
export async function softDelete(store, key) {
  const rec = await get(store, key);
  if (!rec) return null;
  rec.deletedAt = nowISO();
  rec.updatedAt = rec.deletedAt;
  const db = await openDB();
  await reqAsync(db.transaction(store, 'readwrite').objectStore(store).put(rec));
  return rec;
}

/** 論理削除の取り消し(Undoトースト用) */
export async function restore(store, key) {
  const rec = await get(store, key);
  if (!rec) return null;
  rec.deletedAt = null;
  rec.updatedAt = nowISO();
  const db = await openDB();
  await reqAsync(db.transaction(store, 'readwrite').objectStore(store).put(rec));
  return rec;
}

/** 物理削除(GC・初期化用) */
export async function hardDelete(store, key) {
  const db = await openDB();
  await reqAsync(db.transaction(store, 'readwrite').objectStore(store).delete(key));
}

/**
 * インポート用: 複数ストアへの書込を単一トランザクションで原子的に実行。
 * 注意: tx内でawaitすると自動コミットされるため、putは同期的に全発行する。
 * @param {Object<string, any[]>} recordsByStore ストア名→レコード配列
 */
export async function bulkPutSync(recordsByStore) {
  const db = await openDB();
  const names = Object.keys(recordsByStore).filter((n) => STORES.includes(n));
  if (names.length === 0) return;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, 'readwrite');
    tx.oncomplete = () => resolve(undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
    for (const name of names) {
      const store = tx.objectStore(name);
      for (const rec of recordsByStore[name]) store.put(rec);
    }
  });
}

/** 全ストアの物理クリア(「全置換」「初期化」用) */
export async function clearAllStores() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES, 'readwrite');
    tx.oncomplete = () => resolve(undefined);
    tx.onerror = () => reject(tx.error);
    for (const name of STORES) tx.objectStore(name).clear();
  });
}

/* ---- settings ヘルパ ---- */

export async function getSetting(key, defaultValue = null) {
  const rec = await get('settings', key);
  return rec && !rec.deletedAt ? rec.value : defaultValue;
}

export async function putSetting(key, value) {
  return put('settings', { key, value });
}

/* ---- ストレージ保護 ---- */

/** 永続ストレージを要求(iOSのストレージ削除対策の第一歩) */
export async function requestPersist() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      return await navigator.storage.persist();
    }
  } catch { /* noop */ }
  return false;
}

export async function isPersisted() {
  try {
    if (navigator.storage && navigator.storage.persisted) {
      return await navigator.storage.persisted();
    }
  } catch { /* noop */ }
  return false;
}

export async function storageEstimate() {
  try {
    if (navigator.storage && navigator.storage.estimate) {
      return await navigator.storage.estimate();
    }
  } catch { /* noop */ }
  return null;
}

export { uuid, nowISO };
