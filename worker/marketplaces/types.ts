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
  // Reddedilen ilan (Trendyol): ret türleri ve açıklamaları + düzeltme için mevcut içerik
  reject?: { types: string[]; details: string[]; title?: string; description?: string; images?: string[]; categoryId?: string; categoryName?: string };
  // active: güncellenir · closed: pazaryeri kapatmış (kilitli/arşiv), dokunulmaz · pending: onay bekliyor/reddedildi, dokunulmaz ama yeniden açılmaz
  status?: "active" | "closed" | "pending";
}

export interface BatchCheck {
  checked: number;      // sonucu alınan toplu istek
  pending: number;      // süre içinde bitmeyen
  failedItems: number;  // başarısız ürün sayısı
  reasons: string[];    // ilk hatalar: "barkod: neden"
  failed?: { id: string; reason: string }[]; // tüm başarısız ürünler (ürün açmanın tekrar denenmesini engellemek için)
}

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
  asin?: string;        // Amazon: var olan ürüne teklif (LISTING_OFFER_ONLY) için eşleşen ASIN
  price: number;
  qty: number;
}

export interface BatchResult {
  ok: number;           // başarılı gönderilen ürün sayısı
  failed: number;       // başarısız toplu istek sayısı
  batchIds: string[];
  failedItems?: { id: string; reason: string }[]; // anında reddedilen ürünler (ör. Amazon Listings API doğrulaması)
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
  commission(listingId: string | null, xmlCategory: string, panelRate: number | null, defaultRate: number): Commission;
  pushInventory(items: InventoryItem[]): Promise<BatchResult>;
  zeroStock(ids: string[]): Promise<BatchResult>;
  createProducts(items: NewProduct[], ctx: { vatRate: number; skip: (why: string) => void; brandName?: string }): Promise<BatchResult>;
  /** İsteğe bağlı: desi tarifesine göre kargo ücreti (KDV durumu ayarlarda) */
  shippingCost?(desi: number, carrier?: string): number;
  /** İsteğe bağlı: gönderilen toplu isteklerin ürün bazlı sonucu */
  checkBatches?(ids: string[]): Promise<BatchCheck>;
  /** Yeni ürün açmak için pazaryeri kategorisi şart mı (Trendyol/HB evet, Amazon teklif modunda hayır) */
  requiresCategory?: boolean;
  /** Panelden gönderimde pazaryerindeki anahtar (varsayılan: BayilikXML "OS13-"+SKU, diğerleri barkod) */
  listingKeyFor?(source: string, variant: { sku: string; barcode: string | null }): string;
  /** Amazon: barkoddan (EAN/GTIN) veya başlıktan katalog eşleşmesi */
  findCatalogMatches?(q: { ean?: string | null; title?: string }): Promise<CatalogMatch[]>;
  /** İsteğe bağlı: reddedilen ürünleri düzeltip yeniden onaya gönder (Trendyol: unapproved-bulk-update) */
  updateRejected?(items: RejectedUpdate[]): Promise<BatchResult>;
  /** İsteğe bağlı: eşleşme teşhisi, özete eklenir */
  diagnostics?(xml: any[], linkedCount: number): Record<string, unknown>;
}

export interface CatalogMatch { asin: string; title: string; brand?: string; image?: string; by: "ean" | "keyword" }
export interface RejectedUpdate { id: string; title?: string; description?: string; categoryId?: number; images?: string[] }
