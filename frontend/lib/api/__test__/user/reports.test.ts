import { expect, test } from "vitest";
import { factories } from "../factories";
import { UserClient } from "../../user";
import { Requests } from "../../../requests";
import { route } from "../../base";

// Decode RFC4180 quoting, including multiline fields, rather than counting lines.
function parseCSV(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (c === '"') {
      if (quoted && csv[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (c === "," || c === "\n")) {
      row.push(field.replace(/\r$/, ""));
      field = "";
      if (c === "\n") {
        rows.push(row);
        row = [];
      }
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

test("dashboard CSV uses default/active collection, all active nested inventory, and leaves Tools exports unchanged", async () => {
  const { client, user } = await factories.client.singleUse();
  const login = await factories.client.public().login(user.email, user.password);
  expect(login.status).toBe(200);
  const { data: self } = await client.user.self();
  const scoped = (tenant: string) => new UserClient(new Requests("", login.data.token, { "X-Tenant": tenant }), "");
  const types = await client.entityTypes.getAll();
  const itemType = types.data.find(t => !t.isLocation)!;
  const locationType = types.data.find(t => t.isLocation)!;
  const location = await client.items.create({
    name: "CSV storage",
    description: "",
    entityTypeId: locationType.id,
    quantity: 1,
    tagIds: [],
  });
  expect(location.status).toBe(201);
  const activeNames: string[] = [];
  let parentId = location.data.id;
  for (let i = 0; i < 8; i++) {
    const name = i === 1 ? 'Nested, "quoted"\n日本語' : `CSV item ${i}`;
    const item = await client.items.create({
      name,
      description: "",
      entityTypeId: itemType.id,
      parentId,
      quantity: 1,
      tagIds: [],
    });
    expect(item.status).toBe(201);
    activeNames.push(name);
    if (i === 1) {
      const field = { ...factories.itemField(), name: "CSV custom", textValue: 'Field, "quoted"\n日本語' };
      expect(
        (
          await client.items.update(item.data.id, {
            ...item.data,
            entityTypeId: itemType.id,
            parentId,
            tagIds: [],
            fields: [field],
          })
        ).status
      ).toBe(200);
    }
    if (i === 0) parentId = item.data.id;
  }
  const archived = await client.items.create({
    name: "Archived CSV item",
    description: "",
    entityTypeId: itemType.id,
    quantity: 1,
    tagIds: [],
  });
  expect(archived.status).toBe(201);
  expect(
    (
      await client.items.update(archived.data.id, {
        ...archived.data,
        archived: true,
        entityTypeId: itemType.id,
        tagIds: [],
      })
    ).status
  ).toBe(200);

  const response = await client.http.get<unknown>({
    url: route("/reporting/dashboard-inventory"),
  });
  expect(response.status).toBe(200);
  expect(response.response.headers.get("Content-Type")).toContain("text/csv");
  expect(response.response.headers.get("Content-Disposition")).toContain("homebox-dashboard-inventory.csv");
  const rows = parseCSV(await response.response.text());
  const nameIndex = rows[0]!.indexOf("HB.name");
  expect(nameIndex).toBeGreaterThanOrEqual(0);
  expect(
    rows
      .slice(1)
      .map(row => row[nameIndex])
      .sort()
  ).toEqual(activeNames.sort());
  expect(rows.length - 1).toBe((await client.stats.group()).data.totalItems);
  const nested = rows.find(row => row[nameIndex] === 'Nested, "quoted"\n日本語')!;
  expect(nested[rows[0]!.indexOf("HB.field.CSV custom")]).toBe('Field, "quoted"\n日本語');
  expect(nested[rows[0]!.indexOf("HB.location")]).toBe("CSV storage");
  expect(parseCSV(await (await scoped(self.item.defaultGroupId).reports.dashboardInventoryCSV()).text())).toEqual(rows);

  const full = await client.http.get<unknown>({
    url: client.items.exportURL(),
  });
  expect(full.status).toBe(200);
  const fullRows = parseCSV(await full.response.text());
  expect(fullRows[0]).toEqual(rows[0]);
  expect(fullRows.slice(1).map(row => row[nameIndex])).toEqual(
    expect.arrayContaining(["CSV storage", "Archived CSV item", ...activeNames])
  );
  const bom = await client.http.get<unknown>({
    url: client.reports.billOfMaterialsURL(),
  });
  expect(bom.status).toBe(200);
  expect(bom.response.headers.get("Content-Type")).toContain("text/csv");

  const second = await client.group.create("CSV second collection");
  expect(second.status).toBe(201);
  const other = scoped(second.data.id);
  const emptyRows = parseCSV(await (await other.reports.dashboardInventoryCSV()).text());
  expect(emptyRows).toEqual([rows[0]!.filter(header => !header.startsWith("HB.field."))]);
  expect((await other.stats.group()).data.totalItems).toBe(0);
  const otherTypes = await other.entityTypes.getAll();
  expect(
    (
      await other.items.create({
        name: "Other collection inventory",
        description: "",
        entityTypeId: otherTypes.data.find(t => !t.isLocation)!.id,
        quantity: 1,
        tagIds: [],
      })
    ).status
  ).toBe(201);
  const otherRows = parseCSV(await (await other.reports.dashboardInventoryCSV()).text());
  expect(otherRows.slice(1).map(row => row[nameIndex])).toEqual(["Other collection inventory"]);
  expect(parseCSV(await (await client.reports.dashboardInventoryCSV()).text())).toEqual(rows);

  const foreign = await factories.client.singleUse();
  const foreignId = (await foreign.client.user.self()).data.item.defaultGroupId;
  const denied = await scoped(foreignId).http.get<unknown>({
    url: route("/reporting/dashboard-inventory"),
  });
  expect(denied.status).toBe(403);
  expect(denied.response.headers.get("Content-Type")).not.toContain("text/csv");
  await expect(scoped(foreignId).reports.dashboardInventoryCSV()).rejects.toThrow();
  const anonymous = await new Requests("").get<unknown>({
    url: route("/reporting/dashboard-inventory"),
  });
  expect(anonymous.status).toBe(401);
}, 60000);
