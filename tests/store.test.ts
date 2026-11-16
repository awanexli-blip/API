// Vitrin yardımcıları (lib/store.ts). npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { basePath, isStoreHost, slugify, decodeEntities, descriptionBlocks, parseSort, parsePage, searchTerm, likeEscape, imgUrl } from "../lib/store.ts";

test("alan adı: vitrinde kök, panelde /magaza önizleme", () => {
  assert.ok(isStoreHost("ozsaraytr.com") && isStoreHost("www.ozsaraytr.com") && isStoreHost("OZSARAYTR.COM:443"));
  assert.ok(!isStoreHost("trentakip.duckdns.org") && !isStoreHost(null));
  assert.equal(basePath("ozsaraytr.com"), "");
  assert.equal(basePath("trentakip.duckdns.org"), "/magaza");
});

test("slug: Türkçe harfler, SQL slug ile aynı biçim", () => {
  assert.equal(slugify("Anne & Bebek & Çocuk"), "anne-bebek-cocuk");
  assert.equal(slugify("Banyo Yapı & Hırdavat"), "banyo-yapi-hirdavat");
  assert.equal(slugify("Kozmetik & Kişisel Bakım"), "kozmetik-kisisel-bakim");
  assert.equal(slugify("İç Mekân"), "ic-mekan");
});

test("açıklama: çift kaçışlı varlıklar çözülür, HTML metne döner (etiket basılmaz)", () => {
  assert.equal(decodeEntities("&amp;Uuml;r&amp;uuml;n &amp;ccedil;ok g&uuml;zel&nbsp;&#39;x&#39;"), "Ürün çok güzel 'x'");
  const b = descriptionBlocks("<p>Giriş <b>metni</b></p><ul><li>Bir</li><li>İki</li></ul><script>alert(1)</script><img src=x onerror=alert(1)>");
  assert.deepEqual(b, [{ kind: "p", text: "Giriş metni" }, { kind: "li", text: "Bir" }, { kind: "li", text: "İki" }]);
  assert.ok(!JSON.stringify(descriptionBlocks("<a href='javascript:1'>x</a><iframe src=y></iframe>")).includes("<"));
  assert.deepEqual(descriptionBlocks(null), []);
});

test("sorgu parametreleri: sıralama, sayfa, arama sınırları", () => {
  assert.equal(parseSort("fiyat-artan"), "fiyat-artan");
  assert.equal(parseSort("drop table"), "onerilen");
  assert.equal(parsePage("3"), 3);
  assert.equal(parsePage("-1"), 1);
  assert.equal(parsePage("99999"), 1);
  assert.equal(searchTerm(" a "), "");
  assert.equal(searchTerm("  kulaklık "), "kulaklık");
  assert.equal(likeEscape(String.raw`100%_a\b`), String.raw`100\%\_a\\b`);
  assert.equal(imgUrl("storage/v1/x.jpg"), "/storage/v1/x.jpg");
  assert.equal(imgUrl("https://cdn/x.jpg"), "https://cdn/x.jpg");
  assert.equal(imgUrl(null), null);
});
