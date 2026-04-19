import { getDb, initSchema } from "./db";

type Source = "web" | "doporučení" | "inzerát" | "sociální sítě";
type PropertyType = "byt" | "dům" | "komerční";
type PropertyStatus = "aktivní" | "prodáno" | "rezervováno";
type LeadStatus = "nový" | "kontaktován" | "prohlídka" | "nabídka" | "uzavřen";

const FIRST_NAMES = [
  "Jan","Petr","Tomáš","Lukáš","Martin","Pavel","Jiří","Jakub","David","Michal",
  "Eva","Jana","Marie","Kateřina","Lucie","Tereza","Veronika","Hana","Zuzana","Petra",
  "Ondřej","Filip","Adam","Matyáš","Štěpán","Vojtěch","Radek","Miroslav","Karel","Josef",
  "Barbora","Nikola","Kristýna","Markéta","Anna","Denisa","Monika","Dana","Simona","Alena",
  "Aleš","Ivan","Zdeněk","Milan","Roman","Viktor","Richard","Dominik","Jaroslav","Stanislav",
];

const LAST_NAMES = [
  "Novák","Svoboda","Novotný","Dvořák","Černý","Procházka","Kučera","Veselý","Horák","Němec",
  "Marek","Pospíšil","Hájek","Jelínek","Král","Růžička","Beneš","Fiala","Sedláček","Doležal",
  "Zeman","Kolář","Navrátil","Čermák","Urban","Vaněk","Blažek","Kříž","Kubíček","Pokorný",
  "Holub","Tichý","Moravec","Konečný","Bartoš","Mareš","Vlček","Polák","Musil","Šimek",
  "Ryba","Soukup","Štěpánek","Havel","Mach","Křížek","Koudelka","Matoušek","Štván","Tomeš",
];

const PRAHA_DISTRICTS = ["Praha 1","Praha 2","Praha 3","Praha 4","Praha 5","Praha 6","Praha 7","Praha 8","Praha 9","Praha 10"];
const BRNO_DISTRICTS = ["Brno-střed","Brno-sever","Brno-Žabovřesky","Brno-Královo Pole","Brno-Bystrc","Brno-Líšeň","Brno-jih"];
const OSTRAVA_DISTRICTS = ["Moravská Ostrava","Poruba","Mariánské Hory","Slezská Ostrava","Vítkovice","Zábřeh"];

const PRAHA_STREETS = ["Vinohradská","Národní","Wenceslas","Karlova","Pařížská","Ječná","Myslíkova","Londýnská","Jugoslávská","Španělská","Bělehradská","Korunní","Francouzská","Ruská","Americká"];
const BRNO_STREETS = ["Masarykova","Česká","Veveří","Lidická","Kounicova","Zelný trh","Gorkého","Botanická","Husova","Údolní","Kobližná","Nové sady"];
const OSTRAVA_STREETS = ["Hlavní třída","28. října","Nádražní","Stodolní","Českobratrská","Sokolská třída","Porážková","Poděbradova"];

const SOURCES: Source[] = ["web","doporučení","inzerát","sociální sítě"];
const PROPERTY_TYPES: PropertyType[] = ["byt","dům","komerční"];
const PROPERTY_STATUSES: PropertyStatus[] = ["aktivní","prodáno","rezervováno"];
const LEAD_STATUSES: LeadStatus[] = ["nový","kontaktován","prohlídka","nabídka","uzavřen"];

const RECONSTRUCTION_TEXTS = [
  "Kompletní rekonstrukce v roce 2020 – nová elektroinstalace, rozvody vody a topení.",
  "Rekonstrukce kuchyně a koupelny (2022), nová plastová okna.",
  "Částečná rekonstrukce – nová podlaha, vymalováno, vyměněné dveře.",
  "Rekonstrukce v roce 2018, zateplení fasády a nová střecha.",
  "Byt po kompletní rekonstrukci (2023) – developerský standard.",
  "Rekonstrukce společných prostor domu v roce 2021.",
  "Nová elektroinstalace z roku 2019, zbytek v původním stavu.",
  "Kompletní rekonstrukce včetně výměny inženýrských sítí (2021).",
];

const BUILDING_MOD_TEXTS = [
  "Přístavba zimní zahrady v roce 2019, schváleno stavebním úřadem.",
  "Nástavba podkroví se samostatným bytem (2020).",
  "Přistavěná garáž a vjezd, v katastru zapsáno.",
  "Stavební úpravy v roce 2022 – změna dispozice, vše v souladu s projektovou dokumentací.",
  "Zateplení objektu a nová fasáda (2021).",
  "Přístavba terasy a markýzy, bez zásahu do nosných konstrukcí.",
  "Historická rekonstrukce fasády dle památkářů (2020).",
];

const COMMERCIAL_DESCRIPTIONS = [
  "Obchodní prostor v přízemí ideální pro kavárnu nebo butik.",
  "Kancelářské prostory v business centru, recepce, klimatizace.",
  "Skladovací hala s rampou pro nákladní vozidla.",
  "Restaurační prostor s plně vybavenou kuchyní.",
  "Showroom s velkými výlohami na frekventované ulici.",
];

const APARTMENT_DESCRIPTIONS = [
  "Světlý byt s balkonem, jižní orientace, výtah v domě.",
  "Útulný byt v cihlovém domě, původní prvky, vysoké stropy.",
  "Moderní byt po rekonstrukci s lodžií a sklepem.",
  "Prostorný byt s panoramatickým výhledem na město.",
  "Klidný byt ve vnitrobloku, parkování v ulici.",
];

const HOUSE_DESCRIPTIONS = [
  "Rodinný dům se zahradou a dvougaráží v klidné části města.",
  "Patrový dům s podkrovím, bazénem a udržovanou zahradou.",
  "Řadový dům s terasou, ideální pro mladou rodinu.",
  "Samostatně stojící dům s vlastní studnou a ovocnou zahradou.",
  "Dům po rekonstrukci, tepelné čerpadlo, fotovoltaika.",
];

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(min: number, max: number): number { return Math.floor(Math.random() * (max - min + 1)) + min; }

function makeEmail(first: string, last: string, i: number): string {
  const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, "");
  const domains = ["seznam.cz","centrum.cz","email.cz","gmail.com","post.cz"];
  return `${norm(first)}.${norm(last)}${i % 7 === 0 ? i : ""}@${pick(domains)}`;
}

function makePhone(): string {
  const prefixes = ["602","603","604","605","606","607","608","720","721","722","723","724","725","728","730","731","732","733","734","735","736","737","739","770","773","775","776","777","778","792","793","774"];
  const p = pick(prefixes);
  const rest = `${randInt(100, 999)} ${randInt(100, 999)}`;
  return `+420 ${p} ${rest}`;
}

function quarterOf(date: Date): string {
  const q = Math.floor(date.getMonth() / 3) + 1;
  return `${date.getFullYear()}-Q${q}`;
}

function isoDate(d: Date): string { return d.toISOString().slice(0, 19).replace("T", " "); }

function randomDateWithin(daysBack: number, maxDaysBack = daysBack): Date {
  const now = Date.now();
  const offset = randInt(0, maxDaysBack) * 24 * 60 * 60 * 1000;
  const jitter = randInt(0, 24 * 60 * 60 * 1000);
  return new Date(now - offset - jitter);
}

function randomDateInLastYear(): Date {
  return randomDateWithin(365);
}

function makeAddress(city: string): { street: string; district: string } {
  if (city === "Praha") {
    const district = pick(PRAHA_DISTRICTS);
    return { street: `${pick(PRAHA_STREETS)} ${randInt(1, 120)}`, district };
  }
  if (city === "Brno") {
    const district = pick(BRNO_DISTRICTS);
    return { street: `${pick(BRNO_STREETS)} ${randInt(1, 90)}`, district };
  }
  const district = pick(OSTRAVA_DISTRICTS);
  return { street: `${pick(OSTRAVA_STREETS)} ${randInt(1, 80)}`, district };
}

function priceFor(type: PropertyType, city: string, areaM2: number): number {
  const base = city === "Praha" ? 130_000 : city === "Brno" ? 95_000 : 65_000;
  const mult = type === "byt" ? 1.0 : type === "dům" ? 0.9 : 0.75;
  const raw = Math.round(areaM2 * base * mult * (0.85 + Math.random() * 0.3));
  return Math.round(raw / 10_000) * 10_000;
}

export function seed() {
  const db = getDb();
  initSchema();

  db.exec(`DELETE FROM calendar_events; DELETE FROM transactions; DELETE FROM leads; DELETE FROM properties; DELETE FROM clients;
           DELETE FROM sqlite_sequence WHERE name IN ('clients','properties','leads','transactions','calendar_events');`);

  const insertClient = db.prepare(
    `INSERT INTO clients (name, email, phone, source, created_at, quarter,
      budget_min, budget_max, preferred_locality, preferred_rooms, preferred_type, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertProperty = db.prepare(
    `INSERT INTO properties (address, city, district, type, price, area_m2, rooms, status,
      reconstruction_data, building_modifications, description, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertLead = db.prepare(
    `INSERT INTO leads (client_id, property_id, status, source, created_at, last_contact_at, next_action, estimated_commission)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertTx = db.prepare(
    `INSERT INTO transactions (property_id, client_id, sale_price, commission, transaction_date) VALUES (?, ?, ?, ?, ?)`
  );

  const CLIENT_LOCALITIES = [
    "Praha 7","Praha 2","Praha 5","Praha 6","Praha 10",
    "Brno-střed","Brno-Žabovřesky","Moravská Ostrava","Poruba",
  ];
  const CLIENT_ROOMS = ["2+kk","2+1","3+kk","3+1","4+kk","4+1"];
  const CLIENT_NOTES = [
    "Preferuje novostavbu nebo byty po rekonstrukci.",
    "Hledá investiční nemovitost na pronájem.",
    "Rodina s 2 dětmi — důležité blízko školy.",
    "Důraz na parkování a balkon/terasu.",
    "Potřebuje kancelář v centru — flexibilní rozpočet.",
    "Klient ve fázi rozhodování, potřebuje víc informací.",
    "Vysoký rozpočet, hledá prémiový objekt.",
    "Zájem o komerční prostor pro kavárnu.",
    null,
    null,
  ];

  // 50 klientů — 70 % má vyplněný profil preferencí
  const clientTx = db.transaction(() => {
    for (let i = 1; i <= 50; i++) {
      const first = pick(FIRST_NAMES);
      const last = pick(LAST_NAMES);
      const date = randomDateInLastYear();
      const hasProfile = Math.random() < 0.7;
      let budgetMin: number | null = null;
      let budgetMax: number | null = null;
      let preferredLocality: string | null = null;
      let preferredRooms: string | null = null;
      let preferredType: string | null = null;
      let notes: string | null = null;

      if (hasProfile) {
        const prefType = pick(PROPERTY_TYPES);
        preferredType = prefType;
        preferredLocality = pick(CLIENT_LOCALITIES);
        preferredRooms = prefType === "komerční" ? null : pick(CLIENT_ROOMS);
        const baseMin = prefType === "byt" ? randInt(3_500_000, 8_000_000)
          : prefType === "dům" ? randInt(8_000_000, 18_000_000)
          : randInt(5_000_000, 25_000_000);
        budgetMin = baseMin;
        budgetMax = Math.round(baseMin * (1.15 + Math.random() * 0.35));
        notes = pick(CLIENT_NOTES);
      }

      insertClient.run(
        `${first} ${last}`,
        makeEmail(first, last, i),
        makePhone(),
        pick(SOURCES),
        isoDate(date),
        quarterOf(date),
        budgetMin, budgetMax,
        preferredLocality, preferredRooms, preferredType,
        notes
      );
    }
  });
  clientTx();

  // 100 nemovitostí
  const propertyTx = db.transaction(() => {
    for (let i = 1; i <= 100; i++) {
      const city = pick(["Praha","Praha","Praha","Brno","Brno","Ostrava"]);
      const { street, district } = makeAddress(city);
      const type = pick(PROPERTY_TYPES);
      const areaM2 = type === "byt" ? randInt(28, 140) : type === "dům" ? randInt(90, 320) : randInt(60, 500);
      const rooms = type === "byt" ? randInt(1, 5) : type === "dům" ? randInt(3, 8) : null;
      const status = Math.random() < 0.7 ? "aktivní" : Math.random() < 0.5 ? "rezervováno" : "prodáno";
      const reconstruction = Math.random() < 0.55 ? pick(RECONSTRUCTION_TEXTS) : null;
      const buildingMods = Math.random() < 0.35 ? pick(BUILDING_MOD_TEXTS) : null;
      const description = type === "byt" ? pick(APARTMENT_DESCRIPTIONS)
        : type === "dům" ? pick(HOUSE_DESCRIPTIONS) : pick(COMMERCIAL_DESCRIPTIONS);

      insertProperty.run(
        street, city, district, type,
        priceFor(type, city, areaM2),
        areaM2, rooms, status,
        reconstruction, buildingMods, description,
        isoDate(randomDateInLastYear())
      );
    }
  });
  propertyTx();

  // 200 leadů za posledních 6 měsíců — 30 % má last_contact_at staré, 30 % středně, 40 % čerstvé
  const allPropsForCommission = db.prepare(`SELECT id, price FROM properties`).all() as Array<{ id: number; price: number }>;
  const propPriceById = new Map(allPropsForCommission.map((p) => [p.id, p.price]));

  const NEXT_ACTIONS = [
    "Zavolat a potvrdit termín prohlídky.",
    "Poslat nabídky podobných bytů.",
    "Připravit kupní smlouvu k podpisu.",
    "Vyjasnit financování a úvěr.",
    "Sjednat druhou prohlídku.",
    "Zaslat podklady o nemovitosti.",
    "Potvrdit rezervační poplatek.",
    null,
  ];

  const leadTx = db.transaction(() => {
    for (let i = 0; i < 200; i++) {
      const clientId = randInt(1, 50);
      const propertyId = randInt(1, 100);
      const r = Math.random();
      const status: LeadStatus =
        r < 0.25 ? "nový" :
        r < 0.55 ? "kontaktován" :
        r < 0.78 ? "prohlídka" :
        r < 0.92 ? "nabídka" : "uzavřen";

      const created = randomDateWithin(180);

      // last_contact_at — realisticky rozdělené:
      // 40 % čerstvé (0–5 dní), 30 % středně (5–14 dní), 30 % staré (14–45 dní)
      const contactRoll = Math.random();
      let lastContactDaysAgo: number;
      if (contactRoll < 0.4) lastContactDaysAgo = randInt(0, 5);
      else if (contactRoll < 0.7) lastContactDaysAgo = randInt(5, 14);
      else lastContactDaysAgo = randInt(14, 45);
      const lastContact = new Date(Date.now() - lastContactDaysAgo * 86400000 - randInt(0, 86_399_000));
      // Zajisti, že lastContact není dřív než created.
      const lastContactFinal = lastContact.getTime() < created.getTime() ? created : lastContact;

      const nextAction = status === "uzavřen" ? null : pick(NEXT_ACTIONS);

      // Odhadovaná provize: 2–4 % ceny nemovitosti.
      const price = propPriceById.get(propertyId) ?? 0;
      const commissionRate = 0.02 + Math.random() * 0.02;
      const estimatedCommission = Math.round(price * commissionRate);

      insertLead.run(
        clientId, propertyId, status, pick(SOURCES),
        isoDate(created),
        isoDate(lastContactFinal),
        nextAction,
        estimatedCommission
      );
    }
  });
  leadTx();

  // 30 transakcí - navázat na nemovitosti a klienty; preferovat 'prodáno' stav
  const soldProperties = db.prepare(`SELECT id, price FROM properties WHERE status = 'prodáno'`).all() as { id: number; price: number }[];
  const allProperties = db.prepare(`SELECT id, price FROM properties`).all() as { id: number; price: number }[];
  const txTx = db.transaction(() => {
    const pool = soldProperties.length >= 15 ? soldProperties : allProperties;
    for (let i = 0; i < 30; i++) {
      const p = pool[i % pool.length];
      const salePrice = Math.round(p.price * (0.93 + Math.random() * 0.1));
      const commission = Math.round(salePrice * (0.02 + Math.random() * 0.02));
      const date = randomDateWithin(365);
      insertTx.run(p.id, randInt(1, 50), salePrice, commission, isoDate(date));
    }
  });
  txTx();

  // Calendar events — 15-20 událostí na tento + příští týden, Po-Pá 9:00–17:00
  const insertEvent = db.prepare(
    `INSERT INTO calendar_events (title, client_id, property_id, start_time, end_time, type, location, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const clientsForCal = db.prepare(`SELECT id, name FROM clients ORDER BY RANDOM() LIMIT 40`).all() as Array<{ id: number; name: string }>;
  const propsForCal = db.prepare(`SELECT id, address FROM properties WHERE status = 'aktivní' ORDER BY RANDOM() LIMIT 40`).all() as Array<{ id: number; address: string }>;

  const EVENT_TYPES = ["prohlídka", "meeting", "hovor", "jiné"] as const;
  const MEETING_TITLES = [
    "Konzultace ohledně hledání bytu",
    "Kávové setkání",
    "Projednání podmínek smlouvy",
    "Rekapitulace preferencí",
    "Prezentace portfolia",
  ];
  const CALL_TITLES = [
    "Telefonát — follow-up",
    "Hovor o financování",
    "Upřesnění termínu prohlídky",
    "Call s klientem",
  ];
  const OTHER_TITLES = [
    "Focení nemovitosti",
    "Inzerátní meeting — marketing",
    "Interní plánování týdne",
  ];
  const MEETING_LOCS = ["Kancelář Realitka, Vinohradská 1", "Café Lounge, Praha 1", "Online — Google Meet", "Klientská kancelář"];

  function startOfDay(d: Date): Date {
    const c = new Date(d);
    c.setHours(0, 0, 0, 0);
    return c;
  }
  function mondayOf(d: Date): Date {
    const c = startOfDay(d);
    const dow = c.getDay(); // 0=Ne
    const diff = dow === 0 ? -6 : 1 - dow;
    c.setDate(c.getDate() + diff);
    return c;
  }

  const today = new Date();
  const thisMonday = mondayOf(today);
  const daysPool: Date[] = [];
  for (let w = 0; w < 2; w++) {
    for (let d = 0; d < 5; d++) {
      const day = new Date(thisMonday);
      day.setDate(thisMonday.getDate() + w * 7 + d);
      daysPool.push(day);
    }
  }

  const todayIdx = daysPool.findIndex((d) => startOfDay(d).getTime() === startOfDay(today).getTime());
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const tomorrowIdx = daysPool.findIndex((d) => startOfDay(d).getTime() === startOfDay(tomorrow).getTime());

  // Rozvrh: 3-4 dnes, 3 zítra, zbytek rozdělit po 1-2 na zbylé dny. Celkem 15-20.
  const plan: Array<{ dayIdx: number; startHour: number; startMin: number; durMin: number }> = [];
  const addSlots = (dayIdx: number, count: number) => {
    if (dayIdx < 0) return;
    const usedHours = new Set<number>();
    for (let i = 0; i < count; i++) {
      let h = 9 + randInt(0, 7);
      let tries = 0;
      while (usedHours.has(h) && tries < 10) { h = 9 + randInt(0, 7); tries++; }
      usedHours.add(h);
      const m = pick([0, 15, 30, 45]);
      const dur = pick([45, 60, 60, 90]);
      plan.push({ dayIdx, startHour: h, startMin: m, durMin: dur });
    }
  };

  if (todayIdx >= 0) addSlots(todayIdx, 4);
  if (tomorrowIdx >= 0) addSlots(tomorrowIdx, 3);
  // Zbytek
  const remainingDays = daysPool.map((_, i) => i).filter((i) => i !== todayIdx && i !== tomorrowIdx);
  for (const di of remainingDays) {
    addSlots(di, randInt(1, 2));
  }
  // Celkem cílíme na 15-20.
  while (plan.length < 15) {
    addSlots(remainingDays[randInt(0, remainingDays.length - 1)], 1);
  }
  if (plan.length > 20) plan.length = 20;

  const calTx = db.transaction(() => {
    for (const slot of plan) {
      const day = daysPool[slot.dayIdx];
      const start = new Date(day);
      start.setHours(slot.startHour, slot.startMin, 0, 0);
      const end = new Date(start.getTime() + slot.durMin * 60_000);

      const typ = (() => {
        const r = Math.random();
        if (r < 0.45) return "prohlídka";
        if (r < 0.75) return "meeting";
        if (r < 0.92) return "hovor";
        return "jiné";
      })() as typeof EVENT_TYPES[number];

      const client = clientsForCal.length ? pick(clientsForCal) : null;
      const prop = typ === "prohlídka" && propsForCal.length ? pick(propsForCal) : (Math.random() < 0.2 && propsForCal.length ? pick(propsForCal) : null);

      let title: string;
      let location: string | null = null;
      if (typ === "prohlídka" && prop) {
        title = `Prohlídka — ${prop.address}${client ? ` (${client.name})` : ""}`;
        location = prop.address;
      } else if (typ === "meeting") {
        title = client ? `${pick(MEETING_TITLES)} — ${client.name}` : pick(MEETING_TITLES);
        location = pick(MEETING_LOCS);
      } else if (typ === "hovor") {
        title = client ? `${pick(CALL_TITLES)} — ${client.name}` : pick(CALL_TITLES);
        location = "Telefon";
      } else {
        title = pick(OTHER_TITLES);
        location = pick(MEETING_LOCS);
      }

      const notes = Math.random() < 0.35
        ? pick([
            "Přinést tištěné podklady.",
            "Potvrdit účast den předem SMS.",
            "Klient zmínil zájem o financování.",
            "Druhá prohlídka — pozor na dotazy k rekonstrukci.",
            "Připravit srovnání s alternativními nabídkami.",
          ])
        : null;

      insertEvent.run(
        title,
        client?.id ?? null,
        prop?.id ?? null,
        isoDate(start),
        isoDate(end),
        typ,
        location,
        notes,
        isoDate(new Date()),
      );
    }
  });
  calTx();

  const counts = {
    clients: (db.prepare(`SELECT COUNT(*) AS c FROM clients`).get() as any).c,
    properties: (db.prepare(`SELECT COUNT(*) AS c FROM properties`).get() as any).c,
    leads: (db.prepare(`SELECT COUNT(*) AS c FROM leads`).get() as any).c,
    transactions: (db.prepare(`SELECT COUNT(*) AS c FROM transactions`).get() as any).c,
    calendar_events: (db.prepare(`SELECT COUNT(*) AS c FROM calendar_events`).get() as any).c,
  };

  console.log("Seed hotov:", counts);
}

if (require.main === module) {
  seed();
}
