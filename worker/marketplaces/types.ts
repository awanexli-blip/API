// Her pazaryeri bu arayüzü uygular. Orkestratör (sync.ts) pazaryeri adı bilmez.

/** Pazaryerinde zaten yayında olan bir ilan */
export interface Listing {
  id: string;        // pazaryerindeki benzersiz anahtar (Trendyol'da barkod)
  title: string;
  price: number;     // mevcut satış fiyatı (NaN olabilir)
  quantity: number;
  vatRate?: number;   // ilandaki KDV oranı (yüzde, örn. 20)
  categoryId?: string;   // pazaryeri kategori ID (yeni ürün kategori tahmini için örnek)
  categoryName?: string;
  commission?: number;   // ilanın komisyon oranı (0-1)
  asin?: string;         // Amazon: ilanın bağlı olduğu ASIN
  attributes?: Record<string, string>; // onaylı ilanın özellikleri (özellik adı -> değer), ürün kaydına öğrenilir
  contentId?: string;    // Trendyol içerik kimliği (onaylı ürün içerik güncellemesi)
  images?: string[];     // ilandaki görseller (yoksa / WebP ise görsel onarımı, worker/core/image-fix.ts)
  // Reddedilen ilan (Trendyol): ret türleri ve açıklamaları + düzeltme için mevcut içerik
  reject?: { types: string[]; details: string[]; title?: string; description?: string; images?: string[]; categoryId?: string; categoryName?: string };
  // active: güncellenir · closed: pazaryeri kapatmış (kilitli/arşiv), dokunulmaz · pending: onay bekliyor/reddedildi, dokunulmaz ama yeniden açılmaz
  status?: "active" | "closed" | "pending";
}

export type OrderLineIn = { lineNo: number; key: string; title: string; qty: number; unitPrice: number; listPrice?: number | null; discount?: number | null; tyDiscount?: number | null;
  commissionRate?: number | null; commissionAmt?: number | null }; // pazaryerinin siparişte bildirdiği komisyon (oran 0-1 / tutar KDV dahil)
// Alıcı ad-soyad ve teslimat adresi: yalnızca tedarikçiye sipariş vermek için (K kararı 23.10), loglanmaz, 30 gün sonra silinir
export type OrderCustomer = { name: string | null; address: { fullAddress?: string; district?: string; city?: string; postalCode?: string; neighborhood?: string } | null };
export type OrderIn = { packageId: string; orderNo: string; status: string; orderedAt: number | null; total: number; currency: string; deadline: number | null; cargo: string | null; tracking: string | null; city: string | null; customer?: OrderCustomer; lines: OrderLineIn[] };
export type QuestionIn = { id: string; text: string; productTitle: string; productKey: string | null; imageUrl: string | null; askedAt: number | null };
// İade talebi (müşteri adı alınmaz)
export type ClaimLineIn = { key: string; title: string; qty: number; price: number; status: string; reason: string | null };
export type ClaimIn = { id: string; orderNo: string | null; packageId: string | null; status: string; reason: string | null; reasonCode: string | null; claimedAt: number | null; amount: number; cargo: string | null; tracking: string | null; lines: ClaimLineIn[] };
// Hakediş kaydı (gerçek komisyon ve satıcıya ödenecek tutar), paket bazında toplanır
export type SettlementIn = { packageId: string | null; orderNo: string | null; commission: number; revenue: number };
// Buybox (rakip fiyatı): sıra 1 = buybox bizde
export type BuyboxInfo = { id: string; order: number | null; price: number | null; second: number | null; third: number | null; multiple: boolean | null };
export type SalesDay = { day: string; orders: number; units: number; revenue: number; cancelled: number; returns: number | null };

export interface BatchCheck {
  checked: number;      // sonucu alınan toplu istek
  pending: number;      // süre içinde bitmeyen
  failedItems: number;  // başarısız ürün sayısı
  reasons: string[];    // ilk hatalar: "barkod: neden"
  failed?: { id: string; reason: string }[]; // tüm başarısız ürünler (ürün açmanın tekrar denenmesini engellemek için)
  statuses?: Record<string, number>; // ürün durumu sayıları (Hepsiburada: Satışa Hazır, İncelenecek, Reddedildi...)
  states?: ItemState[]; // ürün başına durum (ilan tablosuna mp_status olarak yazılır)
  done?: string[];      // sonucu kesinleşen toplu istekler (bir daha sorulmaz)
}

export interface ItemState { id: string; status: string; reasons: string; bad: boolean; final: boolean }

export interface InventoryItem {
  id: string;
  price: number | null; // null = fiyata dokunma, sadece stok
  quantity: number;
}

export interface NewProduct {
  id: string;           // pazaryerinde açılacak yeni anahtar
  name: string;
  detail: string;
  brand: string;
  productCode: string;
  desi: number;
  images: string[];
  cat: any;             // category_map satırı (category_id tahminden de gelebilir)
  refs?: string[];      // benzer mevcut ilanlar (zorunlu özellikleri kopyalamak için)
  defaults?: Record<string, string>; // tedarikçi varsayılan özellikleri (özellik adı -> değer adı, ör. Menşei -> Çin)
  asin?: string;        // Amazon: var olan ürüne teklif (LISTING_OFFER_ONLY) için eşleşen ASIN
  pid?: string; known?: Record<string, unknown>; catName?: string | null; // ürün kaydı (öğrenilen özelliklerin yazılacağı yer)
  xmlCategory?: string; // tedarikçi kategori yolu (garanti/kural tahminleri için)
  learned?: Record<string, string>; // adaptörün başlık/açıklama/benzer ilandan bulduğu özellikler (özellik adı -> değer); ürün kaydına yazılır, diğer pazaryerleri tekrar aramaz
  groupId?: string;     // çok varyantlı ürünün grup kodu (Hepsiburada VaryantGroupID); yoksa varyant kendi başına
  price: number;
  qty: number;
}

export interface BatchResult {
  ok: number;           // başarılı gönderilen ürün sayısı
  failed: number;       // başarısız toplu istek sayısı
  batchIds: string[];
  failedItems?: { id: string; reason: string }[]; // anında reddedilen ürünler (ör. Amazon Listings API doğrulaması)
  errors?: string[];   // başarısız toplu isteklerin ilk hata mesajları (özet: pushErrors)
}

export interface Commission { rate: number; source: string }

export interface Marketplace {
  id: string;
  label: string;
  /** Pazaryerindeki tüm ilanları çek */
  loadListings(): Promise<Listing[]>;
  /** XML ürününe karşılık gelen mevcut ilanın id'si, yoksa null */
  findListing(xml: any, existing: Set<string>): string | null;
  /** XML ürünü yeni açılırsa kullanılacak id */
  newListingId(xml: any): string;
  /** Komisyon: ürün/kategori bazlı kaynaklar adaptöre özgüdür */
  /** hint: pazaryeri kategori adı/yolu ve ürün başlığı (kategori tablosundan oran bulmak için, ör. Hepsiburada EK.4) */
  commission(listingId: string | null, xmlCategory: string, panelRate: number | null, defaultRate: number, hint?: { category?: string; title?: string }): Commission;
  pushInventory(items: InventoryItem[]): Promise<BatchResult>;
  zeroStock(ids: string[]): Promise<BatchResult>;
  archiveProducts?(ids: string[], archived?: boolean): Promise<BatchResult>; // arşivle / arşivden çıkar
  deleteProducts?(ids: string[]): Promise<BatchResult>;                    // kalıcı sil (Trendyol: onaysız ya da 1 günden fazla arşivde)
  createProducts(items: NewProduct[], ctx: { vatRate: number; skip: (why: string) => void; brandName?: string }): Promise<BatchResult>;
  /** İsteğe bağlı: desi tarifesine göre kargo ücreti (KDV durumu ayarlarda) */
  shippingCost?(desi: number, carrier?: string): number;
  /** İsteğe bağlı: gönderilen toplu isteklerin ürün bazlı sonucu */
  /** quick: beklemeden tek tur sor (sonradan yenileme, worker/core/mp-status.ts) */
  checkBatches?(ids: string[], opts?: { quick?: boolean }): Promise<BatchCheck>;
  /** Yeni ürün açmak için pazaryeri kategorisi şart mı (Trendyol/HB evet, Amazon teklif modunda hayır) */
  requiresCategory?: boolean;
  // Stok/fiyat yalnızca pazaryerindeki değerden farklıysa gönderilir (HB: toplu yükleme hız sınırı; her turda 14 bin ilan gidince takılıyordu)
  pushOnlyChanged?: boolean;
  /** Panelden gönderimde pazaryerindeki anahtar (varsayılan: BayilikXML "OS13-"+SKU, diğerleri barkod) */
  listingKeyFor?(source: string, variant: { sku: string; barcode: string | null }): string;
  /** Amazon: barkoddan (EAN/GTIN) veya başlıktan katalog eşleşmesi */
  findCatalogMatches?(q: { ean?: string | null; title?: string }): Promise<CatalogMatch[]>;
  /** İsteğe bağlı: reddedilen ürünleri düzeltip yeniden onaya gönder (Trendyol: unapproved-bulk-update) */
  updateRejected?(items: RejectedUpdate[]): Promise<BatchResult>;
  /** İsteğe bağlı: günlük satış özeti (salt okunur; yalnızca toplamlar, müşteri verisi okunmaz/saklanmaz) */
  salesDaily?(fromMs: number, toMs: number): Promise<SalesDay[]>;
  /** Siparişler (salt okunur, kişisel veri yok: yalnızca il). worker/core/orders.ts */
  fetchOrders?(fromMs: number, toMs: number): Promise<OrderIn[]>;
  /** Onaylı ürünün görsellerini değiştir (Trendyol content-bulk-update) */
  updateImages?(items: { contentId: string; images: string[] }[]): Promise<BatchResult>;
  /** Cevap bekleyen müşteri soruları (müşteri adı döndürülmez) ve cevap gönderme (yalnızca onaylı cevap, worker/core/inbox.ts) */
  fetchQuestions?(): Promise<QuestionIn[]>;
  /** İade talepleri (salt okunur) ve hakediş kayıtları (gerçek komisyon) */
  fetchClaims?(fromMs: number, toMs: number): Promise<ClaimIn[]>;
  fetchSettlements?(fromMs: number, toMs: number): Promise<SettlementIn[]>;
  /** Takip kodunu pazaryerine bildir (yalnızca paneldeki onaylı kuyruktan, worker/core/orders.ts pushTracking) */
  updateTracking?(packageId: string, providerCode: string, trackingNo: string): Promise<void>;
  /** Buybox / rakip fiyatı (Trendyol Ürün Buybox Kontrol, istek başına en fazla 10 barkod) */
  buybox?(ids: string[]): Promise<BuyboxInfo[]>;
  /** Sipariş uçlarının teşhisi (hangi uç çalıştı, alan adları; kişisel veri yok) */
  orderDiag?: Record<string, unknown>;
  answerQuestion?(id: string, text: string): Promise<void>;
  /** İsteğe bağlı: yaprak kategoriler (başlıktan kategori bulmak için, core/category-tree.ts) */
  categoryLeaves?(): Promise<{ id: string; name: string; path: string[] }[]>;
  /** İsteğe bağlı: eşleşme teşhisi, özete eklenir */
  diagnostics?(xml: any[], linkedCount: number): Record<string, unknown>;
}

export interface CatalogMatch { asin: string; title: string; brand?: string; image?: string; by: "ean" | "keyword" }
export interface RejectedUpdate { id: string; title?: string; description?: string; categoryId?: number; images?: string[] }
