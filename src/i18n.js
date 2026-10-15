// -----------------------------------------------------------------------------
// Texts shown in Gladys (connection status, buttons, badges), in English and
// French.
// -----------------------------------------------------------------------------

import { DEVICE_FEATURE_UNITS as U } from '@gladysassistant/integration-sdk';
import { featureSpec } from './mapping.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const both = (en, fr) => ({ en, fr });

/** "40 s", "5 min", "30 h", "3 d" (the same in both languages, but "j" for days in French). */
export function ago(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) {
    return both(`${s} s`, `${s} s`);
  }
  if (s < 3600) {
    const m = Math.round(s / 60);
    return both(`${m} min`, `${m} min`);
  }
  if (s < 2 * 86_400) {
    const h = Math.round(s / 3600);
    return both(`${h} h`, `${h} h`);
  }
  const d = Math.round(s / 86_400);
  return both(`${d} d`, `${d} j`);
}

// --- Values, for the "list the meters heard" button -----------------------------

const SYMBOLS = {
  [U.CUBIC_METER]: ' m³',
  [U.KILOWATT_HOUR]: ' kWh',
  [U.WATT]: ' W',
  [U.CUBIC_METER_PER_HOUR]: ' m³/h',
  [U.CELSIUS]: ' °C',
  [U.PERCENT]: ' %',
  [U.VOLT]: ' V',
  [U.AMPERE]: ' A',
  [U.YEARS]: ' y',
};

/** French names of the features (the Gladys feature names stay in English). */
const FRENCH = {
  Volume: 'volume',
  'Backward volume': 'volume inverse',
  'Volume at billing date': 'volume à la date de relève',
  Energy: 'énergie',
  'Energy production': 'énergie produite',
  'Energy at billing date': 'énergie à la date de relève',
  Power: 'puissance',
  'Production power': 'puissance produite',
  Flow: 'débit',
  'Max flow': 'débit max',
  'Flow temperature': 'température aller',
  'Return temperature': 'température retour',
  'Supply temperature': 'température départ',
  'External temperature': 'température extérieure',
  Temperature: 'température',
  Humidity: 'humidité',
  'Heat cost units': 'unités de répartition',
  'Units at billing date': 'unités à la date de relève',
  Battery: 'batterie',
  'Battery life': 'durée de vie de la pile',
  Signal: 'signal',
};

const lower = (text) => text.charAt(0).toLowerCase() + text.slice(1);

/** One value, readable: "volume 123.529 m³" / "volume 123,529 m³". */
export function describeValue(key, state) {
  const spec = featureSpec(key);
  if (!spec) {
    return both(`${key} ${state}`, `${key} ${state}`);
  }
  const unit = key === 'rssi_dbm' ? ' dBm' : (SYMBOLS[spec.unit] ?? '');
  const unitFr = spec.unit === U.YEARS ? ' ans' : unit;
  return both(
    `${lower(spec.name)} ${state}${unit}`,
    `${FRENCH[spec.name] ?? lower(spec.name)} ${String(state).replace('.', ',')}${unitFr}`,
  );
}

/** Several values, joined. */
export function describeValues(entries) {
  const parts = entries.map(([key, state]) => describeValue(key, state));
  return both(parts.map((p) => p.en).join(', '), parts.map((p) => p.fr).join(', '));
}

export const T = {
  notConfigured: both(
    'Type the address of the MQTT broker wmbusmeters publishes to (for example mqtt://192.168.1.10:1883) in the configuration.',
    "Saisissez l'adresse du broker MQTT sur lequel wmbusmeters publie (par exemple mqtt://192.168.1.10:1883) dans la configuration.",
  ),
  badUrl: (reason) =>
    reason === 'credentials'
      ? both(
          'Put the user name and the password in their own fields, not in the address.',
          "Mettez l'utilisateur et le mot de passe dans leurs champs, pas dans l'adresse.",
        )
      : both(
          'The address is not valid: use mqtt://host:1883, or mqtts://host:8883 for TLS.',
          "L'adresse n'est pas valide : utilisez mqtt://hôte:1883, ou mqtts://hôte:8883 pour TLS.",
        ),
  connecting: both('Connecting to the MQTT broker…', 'Connexion au broker MQTT…'),
  waiting: (topic) =>
    both(
      `Connected to the broker. Waiting for the first wmbusmeters reading on "${topic}" (meters transmit every 8 s to a few minutes)…`,
      `Connecté au broker. En attente du premier relevé wmbusmeters sur « ${topic} » (les compteurs émettent toutes les 8 s à quelques minutes)…`,
    ),
  connected: (heard, created) =>
    both(
      `Connected to the broker: ${plural(heard, 'meter', 'meters')} heard, ${created} in Gladys. Open Discovery to add yours ("List the meters heard" shows their id and values).`,
      `Connecté au broker : ${plural(heard, 'compteur entendu', 'compteurs entendus')}, ${created} dans Gladys. Ouvrez Découverte pour ajouter les vôtres (« Lister les compteurs entendus » montre leur numéro et leurs valeurs).`,
    ),
  unreachable: (message) =>
    both(
      `The MQTT broker is unreachable: ${message}. Retrying every few seconds.`,
      `Le broker MQTT est injoignable : ${message}. Nouvel essai toutes les quelques secondes.`,
    ),
  refused: (message) =>
    both(
      `The MQTT broker refused the connection: ${message}. Check the user name and the password.`,
      `Le broker MQTT a refusé la connexion : ${message}. Vérifiez l'utilisateur et le mot de passe.`,
    ),
  silent: (hours) =>
    both(
      `No reading for ${hours} h: out of range, flat battery, or a meter that only transmits on working hours.`,
      `Aucun relevé depuis ${hours} h : hors de portée, pile épuisée, ou compteur qui n'émet qu'aux heures ouvrées.`,
    ),
  test: {
    ok: (name, seconds, age, heard) =>
      both(
        `Connection OK: wmbusmeters is publishing (${name}, ${age === undefined ? `heard after ${seconds} s` : `retained reading from ${age.en} ago`}). ${plural(heard, 'meter', 'meters')} heard since the start.`,
        `Connexion OK : wmbusmeters publie (${name}, ${age === undefined ? `entendu après ${seconds} s` : `relevé conservé par le broker, d'il y a ${age.fr}`}). ${plural(heard, 'compteur entendu', 'compteurs entendus')} depuis le démarrage.`,
      ),
    silent: (topic, seconds) =>
      both(
        `Connection OK, but no wmbusmeters reading on "${topic}" in ${seconds} s. Check the shell= line of wmbusmeters.conf (mosquitto_pub to this broker and topic), and that a meter of yours is configured: some only transmit every few minutes.`,
        `Connexion OK, mais aucun relevé wmbusmeters sur « ${topic} » en ${seconds} s. Vérifiez la ligne shell= de wmbusmeters.conf (mosquitto_pub vers ce broker et ce topic), et qu'un de vos compteurs y est configuré : certains n'émettent que toutes les quelques minutes.`,
      ),
  },
  list: {
    empty: both(
      'No meter heard yet. wmbusmeters only publishes the meters of its meter files (wmbusmeters.d): add yours, with its key if it is encrypted.',
      "Aucun compteur entendu pour l'instant. wmbusmeters ne publie que les compteurs de ses fichiers de compteurs (wmbusmeters.d) : ajoutez le vôtre, avec sa clé s'il est chiffré.",
    ),
    header: (heard, shown) =>
      both(
        `${plural(heard, 'meter', 'meters')} heard${heard > shown ? ` (the ${shown} heard last)` : ''}, most recent first:`,
        `${plural(heard, 'compteur entendu', 'compteurs entendus')}${heard > shown ? ` (les ${shown} derniers)` : ''}, du plus récent au plus ancien :`,
      ),
    line: ({ name, values, status, count, since, rssi, created }) =>
      both(
        `• ${name}: ${values.en || 'no value supported yet'}${status ? `, status ${status}` : ''}. ${plural(count, 'reading', 'readings')}, last ${since.en} ago${rssi === undefined ? '' : `, ${rssi} dBm`}${created ? ', in Gladys' : ''}.`,
        `• ${name} : ${values.fr || 'aucune valeur prise en charge pour l’instant'}${status ? `, état ${status}` : ''}. ${plural(count, 'relevé', 'relevés')}, dernier il y a ${since.fr}${rssi === undefined ? '' : `, ${rssi} dBm`}${created ? ', dans Gladys' : ''}.`,
      ),
    missingKey: both(
      '  ↳ encrypted and wmbusmeters has no key for it (MISSING_KEY): add key= to its meter file (the key comes from your water company or the meter supplier).',
      "  ↳ chiffré et wmbusmeters n'a pas sa clé (MISSING_KEY) : ajoutez key= dans son fichier de compteur (la clé vient de votre fournisseur d'eau ou du fournisseur du compteur).",
    ),
    failedDecode: both(
      '  ↳ wmbusmeters could not decode it (FAILED_DECODE): a wrong key, or a damaged telegram.',
      "  ↳ wmbusmeters n'a pas pu le décoder (FAILED_DECODE) : mauvaise clé, ou trame abîmée.",
    ),
  },
};
