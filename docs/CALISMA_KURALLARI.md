# Claude Code çalışma kuralları (oturum protokolü)

Amaç: (1) Claude Code kaldığı yeri her oturumda doğru bilsin, (2) hiçbir ekran/düğme "ölü" kalmasın, (3) bir şey yarım bırakılıp unutulmasın. `CLAUDE.md` bu dosyaya işaret eder.

## 1. Oturum başlangıcı (her yeni oturumda, kod yazmadan önce)

1. `git pull`, `git status`, `git log --oneline -10` — yerel ile GitHub aynı mı?
2. `docs/PROGRESS.md` — **en üstteki 2-3 girişi** oku (ne yapıldı, ne açık kaldı, sıradaki adım).
3. `docs/TODO.md` — "Şu an" kutusuna bak, ilk işaretlenmemiş `[ ]` maddeyi bul. Ayrıntı gerekiyorsa `docs/FAZ6_PLAN.md`.
4. Kullanıcıya **tek cümleyle** söyle: "Şu an F? / madde ?, ben bunu yapacağım." Çelişki varsa (dosya ile gerçek kod uyuşmuyor) önce onu raporla.
5. Görev listesini (TaskCreate) bu maddenin alt adımlarıyla kur; son adım her zaman "doğrula ve kaydet".
6. Next.js bu projede güncel ve eski bilgiyle uyuşmayabilir: Next kodu yazmadan önce `node_modules/next/dist/docs/` içindeki ilgili kılavuzu oku (`AGENTS.md`).

## 2. Bir dilim = bir bitmiş iş

Bir madde şu parçaların **hepsi** hazır olunca bitmiş sayılır. Biri eksikse `[~]` kalır, `[x]` yapılmaz.

- [ ] Migration (varsa): `if not exists`, RLS açık, geri alınan transaction'da test edildi
- [ ] API: `guard()`/rol kontrolü, doğrulama (zod), anlaşılır hata kodu ve mesajı
- [ ] Ekran: yükleniyor / boş / hata / başarı durumları var
- [ ] Test: birim ve (pazaryeri/tedarikçi için) sahte servisli test; `npm test` geçiyor
- [ ] `npx tsc --noEmit` ve `npm run build` temiz
- [ ] Ekranda gerçek tıklama denemesi (Playwright veya tarayıcı): beklenen istek gidiyor, beklenen sonuç görünüyor
- [ ] `docs/TODO.md` maddesi işaretlendi, "Şu an" kutusu güncellendi
- [ ] `docs/PROGRESS.md` en üste girdi: ne yapıldı / ne doğrulandı / ne açık / sıradaki adım
- [ ] Commit (anlamlı mesaj) — canlıyı etkileyen şeyse kullanıcıya haber ver

## 3. "Çalışmayan buton" önleme kuralları

Sık yapılan hatalar: istek hiç gitmiyor, hata yutuluyor, düğme nedensiz pasif, sonuç ekranda yenilenmiyor, mobilde tıklanamıyor.

- Her düğmenin davranışı yazılı: tıklayınca **hangi API** çağrılır, **başarıda** ne olur, **hatada** ne görünür.
- Düğme kapalıysa **nedeni** yanında yazar ("Önce tedarikçi seç"). Nedensiz `disabled` yok.
- İstek sırasında düğme "yükleniyor" olur, çift tıklama engellenir. Zaman aşımı (25 sn) sonrası hata mesajı çıkar, sonsuza kadar dönmez.
- Hata yutma yok: `catch` boş olamaz. Kullanıcıya anlaşılır Türkçe mesaj + teknik ayrıntı için konsol/olay kaydı.
- Başarıdan sonra liste/durum **yeniden yüklenir** (eski veri kalmaz).
- Yapılmamış özellik için düğme **gizlenir** ya da açıkça "Yakında" etiketli ve devre dışı olur. Tıklanınca hiçbir şey yapan düğme bırakılmaz.
- Her yeni ekranda Playwright testi: sayfadaki **tüm** düğmelere sırayla tıkla; beklenen ağ isteğini/DOM değişimini doğrula; konsol hatası = test başarısız.
- Telefonda (390 px) dokunma hedefi en az 44 px, yatay taşma yok, alt menü içeriği örtmüyor.
- Next 16 rota `params` Promise'tir; yeni API dosyalarında eski desenle yazma.

## 4. "Unutma" önleme kuralları

- **Tek doğru kaynak dosyalar:** durum `docs/TODO.md` (ne bitti), günlük `docs/PROGRESS.md` (nasıl bitti), plan `docs/FAZ6_PLAN.md`. Sohbet hafızasına güvenme.
- Çok adımlı iş başlamadan **TaskCreate** ile adımları yaz; her adım biter bitmez **TaskUpdate** ile kapat. Oturum yarıda kalırsa PROGRESS'e "yarım kalan: …" yaz.
- Bağlam dolmaya yaklaşırsa (uzun oturum): işi bir dilim bitirip kaydet, PROGRESS'e yaz, **yeni oturum** aç. Yarım iş bırakma.
- Kullanıcı bir kural/karar söylerse (ör. "marka değişmeyecek") `CLAUDE.md` iş kurallarına ya da PROGRESS'e **karar olarak** yaz, sohbette bırakma.
- Başka dosyayı etkileyen değişiklikte (şema, ayar adı, statü kodu) önce `grep` ile tüm kullanım yerlerini bul, hepsini güncelle, listesini PROGRESS'e yaz.
- Ortam değişkeni/secret eklendiyse `CLAUDE.md` §8'e **yalnızca adını** ekle.

## 5. Canlıyı koruma kuralları

- Canlı yazan her şey (tedarikçiye sipariş, pazaryerine fiyat/stok/takip, müşteriye cevap) için **dry-run/önizleme** vardır ve varsayılan budur.
- Tam otomatik gönderim ayarları (`orders_auto_send`, `suppliers.auto_send`) varsayılan **kapalı**; açmak kullanıcı kararıdır.
- Aynı işlem iki kez tetiklenirse tek etki: `idempotency_key`.
- Müşteri verisi (ad, telefon, adres) logda, hata mesajında, commit'te, sohbette yer almaz.
- Secret/anahtar koda ve sohbete yazılmaz; yalnızca GitHub Secrets ve Vercel env.
- Geri döndürülemeyen işlemde (silme, toplu fiyat, toplu gönderim) önce sayıyı ve örnekleri göster, kullanıcı onayı al.
- `main`'e giden worker kodu bir sonraki cron'da canlı çalışır. Riskli değişikliği önce `preview`/test modunda doğrula.

## 6. Model ve çaba seçimi (Claude Code, resmi dokümana göre doğrulandı)

Claude Code'da çaba (effort) seviyeleri: `low`, `medium`, `high`, `xhigh`, `max`. Bizdeki "orta / yüksek / ekstra yüksek" karşılıkları `medium / high / xhigh`. Opus 5.5, Sonnet 5.5, Haiku 5.5 için varsayılan `medium`; Fable 5.1 için `high`. Ayar: `/effort high`, `/model`, `claude --effort xhigh`. `max` yalnızca o oturum için geçerlidir; fazla düşünebilir, her yerde kullanma.

| İş türü | Model | Çaba |
|---|---|---|
| Plan, mimari, migration, fiyat/kâr/sipariş mantığı (para ve veri bütünlüğü etkili) | `opus` (veya `opusplan`: planı Opus, uygulamayı Sonnet yapar) | `high` |
| Rutin ekran, form, liste, CRUD, metin düzeltme | `sonnet` | `medium` (kısa/net) → `high` (doğrulama gerektiren) |
| Zor hata avı, çok dosyalı yeniden düzenleme, güvenlik denetimi, uçtan uca denetim | `opus` | `xhigh` |
| Tek seferlik çok zor sorun / derin güvenlik incelemesi | `opus` (erişimin varsa `fable`) | `max` — önce küçük örnekte dene |
| Küçük yeniden adlandırma, basit sorgu | `sonnet` veya `haiku` | `low`–`medium` |

Kural: **para harcayan/gönderen kod (F4, F5, F6, F9) ve migration'lar en az `high`**. Ekran işleri `medium` ile başlar; test başarısızsa bir kademe artır. Tek oturumda sürekli `xhigh`/`max` tutma: pahalıdır ve gereksiz düşünür; "hepsini ekstra yüksekte yap" önerilmez. Tek seferlik derin geçiş için istemde `ultrathink` yazmak da yeter.

## 7. Yeni oturum için hazır istem (kopyala-yapıştır)

```
Bu projede önce CLAUDE.md ve docs/CALISMA_KURALLARI.md oku, sonra docs/PROGRESS.md'nin en üstteki girişlerini ve docs/TODO.md'deki "Şu an" kutusunu oku. git pull/status yap. Bana tek cümleyle hangi maddede olduğumuzu söyle ve sıradaki ilk işaretlenmemiş maddeyi yap. Görev listesi kur, işi dilim dilim bitir (migration + API + ekran + test), her düğmeyi test et, bitince TODO.md'de işaretle ve PROGRESS.md'ye yaz. Canlıya yazan hiçbir şeyi onaysız çalıştırma.
```
