# Goethe Seat Watcher

Automated availability checker for Goethe-Institut exam bookings (Goethe-Zertifikat B1 in Jordan). Runs on GitHub Actions every 5 minutes and sends email alerts via [Resend](https://resend.com) when a bookable slot becomes available.

## How It Works

1. **Polls** the Goethe examfinder JSON API for available exam dates.
2. **Detects** newly bookable offers (where `buttonLink` is non-empty).
3. **Sends email** to configured recipients when a new slot appears.
4. **Deduplicates** alerts using a cached state file — you only get notified once per newly-available offer.

## Setup

### 1. Fork or Clone

```bash
git clone https://github.com/jaafar-shiha/goethe-seat-watcher.git
cd goethe-seat-watcher
```

### 2. Create a Resend Account

1. Sign up at [resend.com](https://resend.com).
2. Get your API key from the dashboard.
3. Verify a sender:
   - **With domain**: Add DNS records and use `alerts@yourdomain.com`.
   - **Without domain**: Use `onboarding@resend.dev` (limited to sending to your own email only).

### 3. Add GitHub Secrets

Go to your repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:

| Secret Name        | Value                                                    |
|--------------------|----------------------------------------------------------|
| `RESEND_API_KEY`   | Your Resend API key                                      |
| `ALERT_FROM`       | Sender address (e.g., `Goethe Alerts <onboarding@resend.dev>`) |
| `ALERT_RECIPIENTS` | Comma-separated recipient emails (e.g., `you@example.com,friend@example.com`) |

### 4. Enable the Workflow

The workflow at `.github/workflows/goethe-seat-watcher.yml` runs automatically every 5 minutes. You can also trigger it manually via **Actions** → **Goethe Seat Watcher** → **Run workflow**.

## Testing

### Force a Mock Email

To test the email without waiting for a real available slot:

1. Add a GitHub secret: `TEST_FORCE_MOCK` = `1`
2. Run the workflow manually.
3. Check your inbox for the test email.
4. **Delete** the `TEST_FORCE_MOCK` secret afterward to resume real monitoring.

### Local Testing

```bash
cd watcher
cp .env.example .env   # Create .env with your keys
export $(cat .env | xargs)
TEST_FORCE_MOCK=1 node check.js
```

## File Structure

```
goethe-seat-watcher/
├── .github/
│   └── workflows/
│       └── goethe-seat-watcher.yml   # Scheduled workflow
├── watcher/
│   ├── check.js                      # Main watcher script
│   ├── package.json
│   ├── package-lock.json
│   └── state.json                    # Deduplication state (auto-generated)
├── .gitignore
└── README.md
```

## Configuration

### Polling Interval

Edit the cron schedule in `.github/workflows/goethe-seat-watcher.yml`:

```yaml
on:
  schedule:
    - cron: "*/5 * * * *"   # Every 5 minutes
```

Common intervals:
- `*/5 * * * *` — every 5 minutes
- `*/10 * * * *` — every 10 minutes
- `0 * * * *` — every hour

### Target Exam

The script monitors **Goethe-Zertifikat B1** at **Goethe-Institut Jordan (Amman)**. To monitor a different exam or location, update the `ENDPOINT` URL in `watcher/check.js`.

## Limitations

- **Resend without domain**: Can only send to your own verified email. To send to multiple recipients, verify a custom domain.
- **GitHub Actions scheduling**: Runs are "best effort" and may be delayed by several minutes.
- **State cache**: If the cache expires or is cleared, you may receive duplicate alerts.

## License

MIT

