// Her pazaryeri bu arayüzü uygular. Orkestratör (sync.ts) pazaryeri adı bilmez.

/** Pazaryerinde zaten yayında olan bir ilan */
export interface Listing {
  id: string;        // pazaryerindeki benzersiz anahtar (Trendyol'da barkod)
  title: string;
  price: number;     // mevcut satış fiyatı (NaN olabilir)
  quantity: number;
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
  cat: any;             // category_map satırı
  price: number;
  qty: number;
}

export interface BatchResult {
  ok: number;           // başarılı gönderilen ürün sayısı
  failed: number;       // başarısız toplu istek sayısı
  batchIds: string[];
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
  createProducts(items: NewProduct[], ctx: { vatRate: number; skip: (why: string) => void }): Promise<BatchResult>;
  /** İsteğe bağlı: eşleşme teşhisi, özete eklenir */
  diagnostics?(xml: any[], linkedCount: number): Record<string, unknown>;
}
