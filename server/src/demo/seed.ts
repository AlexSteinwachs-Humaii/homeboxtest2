import type { Database } from "bun:sqlite";

import { getUserByEmail, registerUser } from "../auth/users.ts";
import { importEntitiesCsv } from "../contract/csv.ts";

// Same account and inventory as backend/app/api/demo.go SetupDemo.
export const DEMO_EMAIL = "demo@example.com";
export const DEMO_NAME = "Demo";
export const DEMO_PASSWORD_ENV = "HBOX_DEMO_PASSWORD";
export const DEMO_PASSWORD_DEFAULT = "demodemo";

export const DEMO_CSV = `HB.import_ref,HB.location,HB.tags,HB.quantity,HB.name,HB.description,HB.insured,HB.serial_number,HB.model_number,HB.manufacturer,HB.notes,HB.purchase_from,HB.purchase_price,HB.purchase_date,HB.lifetime_warranty,HB.warranty_expires,HB.warranty_details,HB.sold_to,HB.sold_price,HB.sold_date,HB.sold_notes
,Garage,IOT;Home Assistant; Z-Wave,1,Zooz Universal Relay ZEN17,"Zooz 700 Series Z-Wave Universal Relay ZEN17 for Awnings, Garage Doors, Sprinklers, and More | 2 NO-C-NC Relays (20A, 10A) | Signal Repeater | Hub Required (Compatible with SmartThings and Hubitat)",,,ZEN17,Zooz,,Amazon,39.95,10/13/2021,,,,,,,
,Living Room,IOT;Home Assistant; Z-Wave,1,Zooz Motion Sensor,"Zooz Z-Wave Plus S2 Motion Sensor ZSE18 with Magnetic Mount, Works with Vera and SmartThings",,,ZSE18,Zooz,,Amazon,29.95,10/15/2021,,,,,,,
,Office,IOT; Home Assistant; Z-Wave,1,Zooz 110v Power Switch,"Zooz Z-Wave Plus Power Switch ZEN15 for 110V AC Units, Sump Pumps, Humidifiers, and More",,,ZEN15,Zooz,,Amazon,39.95,10/13/2021,,,,,,,
,Downstairs,IOT;Home Assistant; Z-Wave,1,Ecolink Z-Wave PIR Motion Sensor,"Ecolink Z-Wave PIR Motion Detector Pet Immune, White (PIRZWAVE2.5-ECO)",,,PIRZWAVE2.5-ECO,Ecolink,,Amazon,35.58,10/21/2020,,,,,,,
,Entry,IOT;Home Assistant; Z-Wave,1,Yale Security Touchscreen Deadbolt,"Yale Security YRD226-ZW2-619 YRD226ZW2619 Touchscreen Deadbolt, Satin Nickel",,,YRD226ZW2619,Yale,,Amazon,120.39,10/14/2020,,,,,,,
,Kitchen,IOT;Home Assistant; Z-Wave,1,Smart Rocker Light Dimmer,"UltraPro Z-Wave Smart Rocker Light Dimmer with QuickFit and SimpleWire, 3-Way Ready, Compatible with Alexa, Google Assistant, ZWave Hub Required, Repeater/Range Extender, White Paddle Only, 39351",,,39351,Honeywell,,Amazon,65.98,09/30/0202,,,,,,,
`;

export const DEMO_ITEM_NAMES = [
  "Zooz Universal Relay ZEN17",
  "Zooz Motion Sensor",
  "Zooz 110v Power Switch",
  "Ecolink Z-Wave PIR Motion Sensor",
  "Yale Security Touchscreen Deadbolt",
  "Smart Rocker Light Dimmer",
] as const;

export type DemoSeedResult = {
  skipped: boolean;
  email: string;
  groupId: string | null;
  imported: number;
};

export function demoPassword(env: Record<string, string | undefined>): string {
  const value = env[DEMO_PASSWORD_ENV];
  if (value == null || value === "") return DEMO_PASSWORD_DEFAULT;
  return value;
}

export async function seedDemoDatabase(
  db: Database,
  env: Record<string, string | undefined> = process.env,
): Promise<DemoSeedResult> {
  if (getUserByEmail(db, DEMO_EMAIL)) {
    console.log("[homebox] Demo user already exists; skipping demo seeding");
    return { skipped: true, email: DEMO_EMAIL, groupId: null, imported: 0 };
  }

  const password = demoPassword(env);
  let registered: { id: string; email: string; groupId: string };
  try {
    console.log("[homebox] Registering demo user");
    registered = await registerUser(
      db,
      { email: DEMO_EMAIL, name: DEMO_NAME, password },
      env,
      { skipPasswordValidation: true },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("failed to register user")) {
      console.log("[homebox] Demo user concurrently created; skipping seeding");
      return { skipped: true, email: DEMO_EMAIL, groupId: null, imported: 0 };
    }
    console.error(`[homebox] Failed to register demo user: ${message}`);
    throw new Error("failed to setup demo");
  }

  try {
    const imported = importEntitiesCsv(db, registered.groupId, DEMO_CSV);
    console.log("[homebox] Demo setup complete");
    return { skipped: false, email: DEMO_EMAIL, groupId: registered.groupId, imported };
  } catch (err) {
    console.error(`[homebox] Failed to import CSV: ${err instanceof Error ? err.message : err}`);
    throw new Error("failed to setup demo");
  }
}

if (import.meta.main) {
  const { prepareDatabase } = await import("../boot.ts");
  const prepared = prepareDatabase(process.env, process.argv.slice(2));
  try {
    console.log("[homebox] seeding demo data");
    await seedDemoDatabase(prepared.db, process.env);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    prepared.db.close();
  }
}
