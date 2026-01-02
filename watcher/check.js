import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ENDPOINT =
  'https://www.goethe.de/rest/examfinder/exams/institute/O%2010000267?category=E006&type=ER&countryIsoCode=&locationName=&count=10&start=1&langId=11&timezone=37&isODP=0&sortField=startDate&sortOrder=ASC&dataMode=0&langIsoCodes=ar';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const ALERT_FROM = process.env.ALERT_FROM;
const ALERT_RECIPIENTS = process.env.ALERT_RECIPIENTS;
const TEST_FORCE_MOCK = process.env.TEST_FORCE_MOCK === '1';

function requireEnv() {
  const missing = [];
  if (!RESEND_API_KEY) missing.push('RESEND_API_KEY');
  if (!ALERT_FROM) missing.push('ALERT_FROM');
  if (!ALERT_RECIPIENTS) missing.push('ALERT_RECIPIENTS');
  if (missing.length) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }
}

function loadState(statePath) {
  if (!fs.existsSync(statePath)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(statePath, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    console.warn(`Could not read state file, starting fresh: ${err.message}`);
    return {};
  }
}

function saveState(statePath, state) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
}

function buildKey(offer) {
  return (
    offer.offerKey ||
    offer.oid ||
    `${offer.moduleId || 'module'}|${offer.startDate || 'date'}|${
      offer.locationId || 'location'
    }`
  );
}

function isBookable(offer) {
  return Boolean(offer.buttonLink && String(offer.buttonLink).trim());
}

function normalizeOffer(offer) {
  return {
    key: buildKey(offer),
    startDate: offer.startDate,
    endDate: offer.endDate,
    locationName: offer.locationName,
    availability: offer.availability,
    availabilityText: offer.availabilityText,
    buttonLink: offer.buttonLink,
    price: typeof offer.price === 'string' ? offer.price.trim() : offer.price,
  };
}

async function fetchOffers() {
  if (TEST_FORCE_MOCK) {
    console.log('[MOCK] Returning mocked offers (TEST_FORCE_MOCK=1)');
    return [
      {
        startDate: '2026/01/31',
        endDate: '2026/02/01',
        locationName: 'Mock Location',
        availability: 1,
        availabilityText: 'Mock availability',
        price: '100 JOD',
        buttonLink: 'https://example.com/book',
        moduleId: 'MOCK',
        locationId: 'MOCK_LOC',
        offerKey: 'MOCK_OFFER_1',
      },
    ];
  }

  const res = await fetch(ENDPOINT, {
    method: 'GET',
    headers: {
      accept: 'application/json, text/javascript, */*; q=0.01',
      'x-requested-with': 'XMLHttpRequest',
      // Keep headers minimal to avoid brittle cookies; endpoint appears public.
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Fetch failed ${res.status}: ${text}`);
  }

  const data = await res.json();
  return Array.isArray(data.DATA) ? data.DATA : [];
}

function computeTransitions(offers, prevState) {
  const nowIso = new Date().toISOString();
  const nextState = {};
  const newlyBookable = [];

  for (const offer of offers) {
    const norm = normalizeOffer(offer);
    const bookable = isBookable(offer);
    const prev = prevState[norm.key];
    const wasBookable = prev ? prev.bookable === true : false;
    if (bookable && !wasBookable) {
      newlyBookable.push(norm);
    }
    nextState[norm.key] = {
      bookable,
      lastSeen: nowIso,
    };
  }

  // Mark previously known offers not returned in this fetch as not bookable,
  // enabling “disappear then reappear” detection.
  for (const key of Object.keys(prevState)) {
    if (!nextState[key]) {
      nextState[key] = {
        bookable: false,
        lastSeen: nowIso,
      };
    }
  }

  return { newlyBookable, nextState };
}

function formatEmailBody(newOffers) {
  const lines = newOffers.map((o) => {
    return [
      `Date: ${o.startDate} → ${o.endDate}`,
      `Location: ${o.locationName}`,
      `Availability: ${o.availability} (${o.availabilityText})`,
      `Price: ${o.price ?? 'n/a'}`,
      `Book: ${o.buttonLink}`,
    ].join('\n');
  });

  const text = `New Goethe exam availability detected:\n\n${lines.join(
    '\n\n'
  )}\n\nThis alert was generated automatically.`;

  const html = [
    '<h3>New Goethe exam availability detected</h3>',
    ...newOffers.map((o) => {
      return `<div style="margin-bottom:12px;padding:8px;border:1px solid #ddd;border-radius:6px;">
  <div><strong>Date:</strong> ${o.startDate} → ${o.endDate}</div>
  <div><strong>Location:</strong> ${o.locationName}</div>
  <div><strong>Availability:</strong> ${o.availability} (${o.availabilityText})</div>
  <div><strong>Price:</strong> ${o.price ?? 'n/a'}</div>
  <div><strong>Book:</strong> <a href="${o.buttonLink}">${o.buttonLink}</a></div>
</div>`;
    }),
    '<div style="color:#666;font-size:12px;">This alert was generated automatically.</div>',
  ].join('\n');

  return { text, html };
}

async function sendEmail(newOffers) {
  if (!newOffers.length) return;
  const recipients = ALERT_RECIPIENTS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!recipients.length) {
    throw new Error('ALERT_RECIPIENTS yielded no recipients after parsing');
  }

  const { text, html } = formatEmailBody(newOffers);
  const payload = {
    from: ALERT_FROM,
    to: recipients,
    subject: 'Goethe exam slot available',
    text,
    html,
  };

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Resend error ${res.status}: ${errorText}`);
  }
}

async function main() {
  requireEnv();

  const statePath = path.join(__dirname, 'state.json');
  const prevState = loadState(statePath);

  console.log('Fetching offers...');
  const offers = await fetchOffers();
  console.log(`Fetched ${offers.length} offers`);

  const { newlyBookable, nextState } = computeTransitions(offers, prevState);

  if (newlyBookable.length) {
    console.log(`Found ${newlyBookable.length} newly bookable offers. Sending email...`);
    await sendEmail(newlyBookable);
  } else {
    console.log('No new bookable offers detected.');
  }

  saveState(statePath, nextState);
  console.log('State saved.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

