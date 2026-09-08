import type { ColumnSpec, Source } from "../shared/types";
import { createProject, insertSource } from "./db";

/**
 * A worked demo project so the pipeline can be exercised end to end without
 * uploading anything. The material is synthetic but shaped like real InnoBeweegLab
 * fieldwork: a Dutch neighbourhood study with a survey, resident interviews, an
 * expert site assessment, and a counting dataset.
 */

const SURVEY_COLUMNS: ColumnSpec[] = [
  { name: "respondent_id", type: "text", role: "id", dimension: null },
  { name: "buurt", type: "category", role: "group", dimension: null },
  { name: "leeftijdsgroep", type: "category", role: "ignore", dimension: null },
  { name: "veiligheid_score", type: "scale", role: "measure", dimension: "safety", scale_min: 1, scale_max: 5 },
  { name: "groen_waardering", type: "scale", role: "measure", dimension: "greenery", scale_min: 1, scale_max: 5 },
  { name: "voorzieningen_score", type: "scale", role: "measure", dimension: "facilities", scale_min: 1, scale_max: 5 },
  { name: "bankjes_score", type: "scale", role: "measure", dimension: "comfort", scale_min: 1, scale_max: 5 },
  { name: "onderhoud_score", type: "scale", role: "measure", dimension: "maintenance", scale_min: 1, scale_max: 5 },
  { name: "toelichting", type: "text", role: "open-text", dimension: null },
];

const COMMENTS_NOORD = [
  "Het park is overdag prima maar 's avonds durf ik er niet doorheen, er is bijna geen verlichting op het middenpad.",
  "Er staan veel te weinig bankjes. Mijn moeder van 78 wil wel wandelen maar moet halverwege kunnen zitten.",
  "Het groen is echt mooi opgeknapt de laatste jaren, de nieuwe bomen bij de vijver zijn een aanwinst.",
  "Bij de speeltuin ligt altijd zwerfafval en de prullenbakken zitten in het weekend overvol.",
  "Ik mis een rondje dat je kunt lopen zonder over te steken bij de Bosweg, daar rijden auto's echt te hard.",
  "Er is niets te doen voor tieners. Mijn zoon van 14 hangt daarom bij de supermarkt rond.",
  "De hondenpoep op het grasveld is een groot probleem, kinderen kunnen er niet spelen.",
  "Overdag zie ik veel ouderen wandelen, dat is fijn, maar de paden zijn slecht begaanbaar met een rollator.",
  "'s Avonds hangen er scooters bij de ingang, dat geeft veel overlast en herrie.",
  "Ik zou vaker gaan als er een watertappunt was, in de zomer neem ik nu altijd een fles mee.",
  "De verbinding met de wijk aan de overkant ontbreekt, je moet een enorme omweg maken.",
  "Schaduw ontbreekt bij de speeltuin, in de zomer is het er echt te heet voor kleine kinderen.",
  "Ik loop hier elke ochtend, het is schoon en rustig en dat waardeer ik enorm.",
  "De bewegwijzering is onduidelijk, bezoekers vragen mij regelmatig de weg naar de sportvelden.",
  "Sinds de nieuwe fitnesstoestellen er staan zie ik veel meer jongeren sporten in het park.",
  "Er komt bijna nooit iemand van de gemeente kijken, het onkruid staat kniehoog bij de zijingang.",
];

const COMMENTS_ZUID = [
  "Bij ons in Zuid is het echt versteend, er is nauwelijks groen tussen de flats.",
  "Het pleintje is prima onderhouden en de buurtcoach organiseert wekelijks iets, dat werkt goed.",
  "Ik voel me hier veilig, ook 's avonds, er lopen altijd mensen.",
  "Er zijn geen speelplekken voor kinderen onder de zes, alles is gericht op oudere kinderen.",
  "De stoepen zijn smal en staan vol met geparkeerde auto's, met een kinderwagen kom je er niet langs.",
  "We hebben hier een goede loopverbinding naar het winkelcentrum, dat gebruik ik dagelijks.",
  "In de zomer is het snikheet op het plein, er staat geen enkele boom.",
  "De buurtactiviteiten zijn leuk maar ze worden slecht aangekondigd, veel mensen weten er niet van.",
  "Er is te weinig verlichting achter het buurthuis, daar loop ik bewust omheen.",
  "Ik ken mijn buren goed door het samen tuinieren op het buurtplantsoen, dat zou ik uitbreiden.",
  "Het afval wordt netjes opgehaald maar de containers staan midden op de looproute.",
  "Voor ouderen is er weinig te doen, er is geen plek om even te zitten en een praatje te maken.",
];

function buildSurveyRows(): (string | number | null)[][] {
  const rows: (string | number | null)[][] = [];
  const ages = ["18-34", "35-54", "55-69", "70+"];
  // Deterministic pseudo-random so the demo is identical on every deploy.
  let seed = 20260908;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = (base: number, spread: number) =>
    Math.max(1, Math.min(5, Math.round(base + (rand() - 0.5) * spread)));

  COMMENTS_NOORD.forEach((comment, i) => {
    rows.push([
      `N${String(i + 1).padStart(3, "0")}`, "Parkzone Noord", ages[i % ages.length],
      pick(2.6, 2), pick(3.9, 1.6), pick(2.9, 2), pick(2.2, 1.8), pick(2.7, 2), comment,
    ]);
  });
  COMMENTS_ZUID.forEach((comment, i) => {
    rows.push([
      `Z${String(i + 1).padStart(3, "0")}`, "Wijk Zuid", ages[(i + 2) % ages.length],
      pick(3.7, 1.6), pick(2.3, 1.8), pick(3.4, 1.8), pick(3.1, 1.8), pick(3.8, 1.4), comment,
    ]);
  });
  return rows;
}

const INTERVIEWS = `Interviewer: We zitten hier in het buurthuis. Kunt u vertellen hoe u het park gebruikt?

R1: Ik wandel er elke dag met de hond, 's ochtends rond een uur of acht. Dan is het rustig en zie ik altijd dezelfde mensen. Maar zodra het donker wordt ga ik er niet meer heen. Het middenpad is pikdonker en er zijn geen lantaarns. Mijn dochter wil dat ik omloop via de straat, dat is drie keer zo ver.

Interviewer: En hoe is dat voor u overdag?

R1: Overdag prima. Alleen zijn er echt te weinig bankjes. Ik ben 71 en ik moet halverwege even zitten, anders red ik het rondje niet. Er staan er twee, en die staan allebei aan de kant van de vijver, niet op de route die ik loop.

R2: Wat mij vooral opvalt is dat er niets is voor de leeftijd van mijn kinderen. Die zijn twaalf en veertien. De speeltuin is voor kleuters en de sportvelden zijn van de club. Dus hangen ze in de winkelstraat. Als er een pannaveldje of een half basketbalveld zou zijn, waren ze er zo.

Interviewer: Merkt u verschil tussen Noord en Zuid?

R2: Zeker. In Zuid is het veel steniger, daar is bijna geen groen. Maar daar gebeurt wel meer, er is een buurtcoach die dingen organiseert. Bij ons in Noord is het groener maar er gebeurt niks. Het is een beetje het omgekeerde.

R3: Ik werk in de zorg en zie het van twee kanten. Voor mijn cliënten met een rollator is dit park eigenlijk niet toegankelijk. De paden zijn half zand, half klinkers, en na regen staan er plassen. Bij de hoofdingang ligt een drempel van zeker vijf centimeter. Dat klinkt niks maar met een rollator kom je daar niet overheen.

R3: En de bewegwijzering is er gewoon niet. Ik moet mensen altijd uitleggen hoe ze bij de sportvelden komen, terwijl dat vanaf de ingang niet te zien is.

R4: Ik vind het juist heel fijn hier. Sinds die nieuwe fitnesstoestellen er staan zie ik veel meer jongeren sporten, ook meisjes, en dat was eerst niet zo. Dat werkt echt.

R4: Waar ik me wel aan erger is het zwerfafval bij de speeltuin. In het weekend zitten de prullenbakken overvol en dan waait het over het gras. En hondenpoep, daar wordt niks aan gedaan.

R5: In Zuid voel ik me veilig, ook 's avonds, omdat er altijd mensen lopen. Maar achter het buurthuis is één donkere hoek, daar loop ik bewust omheen. Het is echt maar één lamp die het niet doet, maar het verpest dat hele stuk.

R5: En hitte. Op het plein staat geen enkele boom. In juli is het daar niet uit te houden, dan zit iedereen binnen. Terwijl dat plein juist de plek zou moeten zijn waar je elkaar tegenkomt.

R6: De verbinding tussen Noord en Zuid is het grootste probleem, denk ik. Je moet omlopen via de Bosweg en daar rijden auto's veel te hard. Er is geen oversteekplaats. Ik laat mijn kinderen daar niet alleen oversteken, dus fietsen we om, en dat is tien minuten extra.

R7: Ik ken mijn buren eigenlijk alleen van het buurtplantsoen waar we samen tuinieren. Dat is begonnen met vier mensen en nu zijn we met vijftien. Dat soort dingen zou je moeten uitbreiden, dat kost bijna niks.`;

const EXPERT_ASSESSMENT = `Schouwrapportage Parkzone Noord en Wijk Zuid — ruimtelijk ontwerp en beweegvriendelijkheid.
Uitgevoerd door twee ontwerpers en een adviseur publieke gezondheid, veldbezoek op twee dagdelen.

Verlichting en sociale veiligheid. De verlichting op de hoofdroute door Parkzone Noord voldoet niet aan de gangbare norm voor een doorgaande langzaamverkeersroute. Op het middentraject van circa 180 meter ontbreekt armatuur volledig. In combinatie met de dichte beplanting langs dat traject ontstaat een route zonder zicht op de omgeving. Dit verklaart het vermijdingsgedrag dat bewoners rapporteren en maakt de route feitelijk onbruikbaar na zonsondergang gedurende het winterhalfjaar.

Zitgelegenheid en verblijfskwaliteit. Wij tellen twee zitelementen in het gehele parkgebied, beide geconcentreerd bij de vijver. De gangbare vuistregel voor een wandelrondje dat ook door ouderen gebruikt kan worden is een zitgelegenheid per 100 tot 150 meter. Het huidige rondje van circa 900 meter zou dan zes tot negen zitplekken vragen. Dit is de meest kosteneffectieve ingreep die het bereik van het park onder ouderen direct vergroot.

Toegankelijkheid. De hoofdentree kent een niveauverschil van naar schatting vijf centimeter zonder afgeschuinde overgang. De halfverharding op het noordelijke tracé is na neerslag slecht begaanbaar voor rollator en rolstoel. Feitelijk is daarmee een deel van het netwerk niet toegankelijk voor mensen met een mobiliteitsbeperking, ook al is het park formeel openbaar.

Groenstructuur. De groenstructuur in Parkzone Noord is van goede kwaliteit en recent versterkt. In Wijk Zuid is het beeld omgekeerd: het centrale plein is volledig verhard zonder enige boomstructuur. Bij hittegolven is dit plein onbruikbaar als verblijfsplek. De verhardingsgraad van dit plein schat ik op boven de negentig procent.

Voorzieningen naar leeftijd. Het aanbod is sterk gericht op de leeftijdsgroep tot ongeveer tien jaar en op georganiseerde sport via de verenigingen. Voor de groep tussen tien en zestien jaar ontbreekt informeel aanbod vrijwel geheel. Dit is een bekend patroon en verklaart de verplaatsing van deze groep naar het winkelgebied.

Netwerk en verbindingen. De ontbrekende oversteek op de Bosweg breekt het langzaamverkeersnetwerk tussen Noord en Zuid. De gemeten omrijafstand bedraagt ongeveer 700 meter. Voor dagelijkse verplaatsingen te voet is dit een harde barrière.

Programmering. In Wijk Zuid is sprake van actieve programmering via een buurtcoach met wekelijkse activiteiten. In Parkzone Noord ontbreekt dit volledig. De ruimtelijke kwaliteit en de programmatische inzet zijn tussen beide gebieden precies omgekeerd verdeeld, wat kansen biedt voor uitwisseling.

Beheer. Het beeld van beheer en onderhoud is wisselend. Bij de speelvoorziening in Noord constateren wij achterstallig beheer: overvolle afvalbakken, zwerfafval en opschot langs de zijentree. In Zuid is het onderhoudsniveau merkbaar hoger.`;

const COUNT_COLUMNS: ColumnSpec[] = [
  { name: "meetpunt", type: "text", role: "id", dimension: null },
  { name: "gebied", type: "category", role: "group", dimension: null },
  { name: "dagdeel", type: "category", role: "ignore", dimension: null },
  { name: "passanten_per_uur", type: "number", role: "measure", dimension: "connectivity", scale_min: null, scale_max: null, unit: "per hour" },
  { name: "verblijfsduur_minuten", type: "number", role: "measure", dimension: "comfort", scale_min: null, scale_max: null, unit: "minutes" },
  { name: "aandeel_65plus_procent", type: "number", role: "measure", dimension: "inclusivity", scale_min: null, scale_max: null, unit: "%" },
];

function buildCountRows(): (string | number | null)[][] {
  const rows: (string | number | null)[][] = [];
  const parts = ["ochtend", "middag", "avond"];
  const spec: [string, string, number, number, number][] = [
    ["MP01", "Parkzone Noord", 42, 14, 24],
    ["MP02", "Parkzone Noord", 31, 22, 31],
    ["MP03", "Parkzone Noord", 27, 9, 18],
    ["MP04", "Wijk Zuid", 58, 11, 12],
    ["MP05", "Wijk Zuid", 64, 18, 9],
    ["MP06", "Wijk Zuid", 49, 7, 14],
  ];
  let seed = 771;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (const [point, area, flow, dwell, elderly] of spec) {
    parts.forEach((part, i) => {
      const evening = part === "avond";
      rows.push([
        `${point}-${part}`, area, part,
        Math.round(flow * (evening && area === "Parkzone Noord" ? 0.3 : 1) * (0.8 + rand() * 0.4)),
        Math.round(dwell * (evening ? 0.7 : 1) * (0.8 + rand() * 0.4)),
        Math.round(elderly * (evening ? 0.4 : 1) * (0.85 + rand() * 0.3)),
      ]);
      void i;
    });
  }
  return rows;
}

type NewSource = Omit<Source, "id" | "project_id" | "created_at" | "standardized" | "row_count">;

export async function seedDemoProject(db: D1Database): Promise<string> {
  const project = await createProject(db, {
    name: "Beweegvriendelijke inrichting Parkzone Noord & Wijk Zuid",
    municipality: "Gemeente Eindhoven",
    neighbourhood: "Parkzone Noord & Wijk Zuid",
    period: "maart – juni 2026",
    research_question:
      "Welke ruimtelijke en programmatische ingrepen vergroten dagelijks beweeggedrag in " +
      "Parkzone Noord en Wijk Zuid, en voor welke groepen werkt de openbare ruimte nu niet?",
  });

  const sources: NewSource[] = [
    {
      name: "Bewonersenquête beweegvriendelijkheid",
      kind: "survey", perspective: "resident", format: "csv",
      collected_at: "2026-04-18", notes: "28 respondenten, huis-aan-huis en online uitgezet.",
      raw_text: null,
      columns: SURVEY_COLUMNS,
      rows: buildSurveyRows(),
    },
    {
      name: "Bewonersinterviews ronde 2",
      kind: "interview", perspective: "resident", format: "text",
      collected_at: "2026-05-06", notes: "Zeven semi-gestructureerde interviews in het buurthuis.",
      raw_text: INTERVIEWS, columns: null, rows: null,
    },
    {
      name: "Expertschouw ruimtelijk ontwerp",
      kind: "expert", perspective: "expert", format: "text",
      collected_at: "2026-05-21", notes: "Twee ontwerpers en een adviseur publieke gezondheid.",
      raw_text: EXPERT_ASSESSMENT, columns: null, rows: null,
    },
    {
      name: "Passanten- en verblijfstellingen",
      kind: "dataset", perspective: "quantitative", format: "xlsx",
      collected_at: "2026-06-02", notes: "Zes meetpunten, drie dagdelen, geteld over twee weken.",
      raw_text: null, columns: COUNT_COLUMNS, rows: buildCountRows(),
    },
  ];

  for (const source of sources) await insertSource(db, project.id, source);
  return project.id;
}
