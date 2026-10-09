// Same upstreams as v1_ctrl_product_search.go. The trial UPCItemDB lookup and
// Open*Facts product API do not need an account. Barcode Spider is optional
// and only called when HBOX_BARCODE_TOKEN_BARCODESPIDER is set.

const OPEN_FACTS = [
  { name: "openfoodfacts.org", base: "https://world.openfoodfacts.org" },
  { name: "openbeautyfacts.org", base: "https://world.openbeautyfacts.org" },
  { name: "openproductsfacts.org", base: "https://world.openproductsfacts.org" },
];

export type BarcodeHit = {
  barcode: string;
  imageBase64: string;
  imageURL: string;
  manufacturer: string;
  modelNumber: string;
  notes: string;
  search_engine_name: string;
  item: { name: string; description: string; quantity: number; entityTypeId: string; tagIds: string[] };
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function userAgent(contact: string): string {
  const safe = contact.replace(/[\r\n]/g, "").trim();
  if (!safe) return "Homebox/1.0 (https://github.com/sysadminsmedia/homebox)";
  return `Homebox/1.0 (contact: ${safe})`;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  return JSON.parse(text.slice(0, 4 * 1024 * 1024));
}

function product(source: string, ean: string, name: string, extra: Partial<BarcodeHit> = {}): BarcodeHit {
  return {
    barcode: ean,
    imageBase64: "",
    imageURL: extra.imageURL ?? "",
    manufacturer: extra.manufacturer ?? "",
    modelNumber: extra.modelNumber ?? "",
    notes: extra.notes ?? "",
    search_engine_name: source,
    item: {
      name,
      description: extra.item?.description ?? "",
      quantity: 1,
      entityTypeId: "",
      tagIds: [],
    },
  };
}

export function upcItemDbUrl(ean: string): string {
  return `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(ean)}`;
}

export function openFactsUrl(base: string, ean: string): string {
  return `${base.replace(/\/$/, "")}/api/v2/product/${encodeURIComponent(ean)}.json`;
}

export async function searchBarcode(
  ean: string,
  env: Record<string, string | undefined> = process.env,
  fetchImpl: FetchLike = fetch,
): Promise<BarcodeHit[]> {
  const jobs: Array<Promise<BarcodeHit[]>> = [
    lookupUpc(ean, fetchImpl),
    ...OPEN_FACTS.map((source) => lookupOpenFacts(source, ean, env.HBOX_BARCODE_OPENFOODFACTS_CONTACT ?? "", fetchImpl)),
  ];
  const token = env.HBOX_BARCODE_TOKEN_BARCODESPIDER ?? "";
  if (token) jobs.push(lookupSpider(ean, token, fetchImpl));
  const settled = await Promise.allSettled(jobs);
  return settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
}

async function lookupUpc(ean: string, fetchImpl: FetchLike): Promise<BarcodeHit[]> {
  const response = await fetchImpl(upcItemDbUrl(ean));
  if (!response.ok) return [];
  const body = (await readJson(response)) as { items?: Array<Record<string, unknown>> };
  return (body.items ?? []).flatMap((item) => {
    const name = String(item.title ?? "");
    if (!name) return [];
    return [
      product("upcitemdb.com", ean, name, {
        manufacturer: String(item.brand ?? ""),
        modelNumber: String(item.model ?? ""),
        item: { name, description: String(item.description ?? ""), quantity: 1, entityTypeId: "", tagIds: [] },
        imageURL: Array.isArray(item.images) ? String(item.images[0] ?? "") : "",
      }),
    ];
  });
}

async function lookupOpenFacts(
  source: { name: string; base: string },
  ean: string,
  contact: string,
  fetchImpl: FetchLike,
): Promise<BarcodeHit[]> {
  const response = await fetchImpl(openFactsUrl(source.base, ean), { headers: { "user-agent": userAgent(contact) } });
  if (response.status === 404 || !response.ok) return [];
  const body = (await readJson(response)) as { status?: number; product?: Record<string, string> };
  if (!body.status || !body.product) return [];
  const name = body.product.product_name || body.product.generic_name || body.product.brands || "";
  if (!name) return [];
  const description = [body.product.generic_name, body.product.categories, body.product.quantity]
    .map((value) => (value ?? "").trim())
    .filter((value) => value && value !== name)
    .join(" | ");
  return [
    product(source.name, ean, name, {
      manufacturer: body.product.brands ?? "",
      item: { name, description, quantity: 1, entityTypeId: "", tagIds: [] },
      imageURL: body.product.image_front_url || body.product.image_url || "",
    }),
  ];
}

async function lookupSpider(ean: string, token: string, fetchImpl: FetchLike): Promise<BarcodeHit[]> {
  const response = await fetchImpl(`https://api.barcodespider.com/v1/lookup?token=${encodeURIComponent(token)}&upc=${encodeURIComponent(ean)}`);
  if (!response.ok) return [];
  const body = (await readJson(response)) as { item_attributes?: Record<string, string> };
  const item = body.item_attributes;
  if (!item?.title) return [];
  return [
    product("barcodespider.com", ean, item.title, {
      manufacturer: item.manufacturer || item.brand || "",
      modelNumber: item.model || "",
      item: { name: item.title, description: item.description ?? "", quantity: 1, entityTypeId: "", tagIds: [] },
      imageURL: item.image ?? "",
    }),
  ];
}
