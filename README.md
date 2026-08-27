# TMS Web — Transport Management for an In-House Fleet

A dispatch office runs on two questions all day: *where is the truck*, and *did the customer
actually get the goods*. This is the web app that answers both without anyone picking up
the phone.

## The gap it fills

The company already runs a TMS. That system does its job right up to the moment a trip is
handed to a carrier — and then it stops. For trips the company's own fleet drives, everything
after that point used to live on paper, in chat threads, and in calls asking a driver where
he is.

This app takes over exactly there. It reads the trips the corporate TMS has planned, turns
them into work a driver can accept on his phone, and follows that work until there is a
signature to show for it. It never writes a single byte back into the corporate TMS.

## How a day goes

**Trips arrive on their own.** Confirmed trips are pulled in from the corporate TMS and land
on a planner's screen. What the system cannot decide by itself is who a driver name refers
to: the first time a name appears, it waits for a planner to answer *who is this* — once.
The answer is remembered, and trips already waiting on that same name go out to the phone
straight away. Handing work to a driver stays a planner's decision, not a timer's.

**The driver works from a stop list.** He opens his phone, accepts the job, and sees every
shop on the trip as one row each. He decides the order himself, because he knows the traffic
and the loading dock, and the app never argues with that. At a shop he taps once to close it,
however many picking lists it holds, and hands the phone over for a signature. Photos,
location and time are attached automatically.

**The office watches without interrupting.** A planner sees which trips reached a driver,
which are still waiting, which driver reported a problem, and where each truck is right now.
Nobody has to call anyone to find out.

**The proof stays.** Every delivery keeps its signature, its photos, its coordinates and its
timestamps. Once verified, it cannot be edited.

## What it refuses to do

Good software is defined as much by what it declines. This one declines four things on
purpose.

**It does not write back to the corporate TMS.** Every call to it is a read, and the list of
endpoints it may touch is fixed server-side. The system of record stays the system of record.

**It does not guess when a wrong guess costs someone.** Driver names in the TMS are free
text; a clever match once assigned a day's work to the wrong man. Now the system asks a human
and remembers the answer, which is automation without the guessing.

**It does not track anyone off the clock.** Location recording starts when a driver accepts a
job and stops when he closes it — never before, never after — and it deletes itself after
thirty days. His screen says plainly, at all times, whether recording is on.

**It does not print zero where it means "unknown".** A number the source never sent is shown
as unknown, not as 0, because 0 reads as "there is nothing there" and sends people to a shop
expecting an empty truck.

## Who uses it

**Planners** confirm what arrives, name any driver the system does not recognise yet, and
watch the day unfold. **Drivers** get one screen with their trips, their stops and the
evidence they need to capture, sized for a thumb and readable through a windscreen.
**Administrators** manage accounts, permission groups, vehicles and the driver roster.

Permissions are enforced in the database, not in the interface. A driver sees only his own
work because the data layer will not return anyone else's — not because a screen chose to
hide it.

## Running it

You need Node 20 or newer and a Supabase project. Everything below runs from the repository
root.

```
npm install
cp web/.env.example web/.env      # then fill in the two Supabase values
npm run dev                       # http://localhost:5173
```

`web/.env.example` explains each value and, more importantly, which one must never appear
there. The anon key is meant to be public — it ships inside the bundle. Access is decided by
row level security in the database, not by keeping that key secret.

### Two modes

| Command | Data comes from |
|---|---|
| `npm run dev` / `npm run build` | the real Supabase project |
| `npm run dev:demo` / `npm run build:demo` | fabricated data, no network calls at all |

Demo mode swaps the whole `src/api` layer for `src/demo` through Vite aliases, so no
production file carries a branch for fake data. Use it for screenshots and for showing the
app to someone without handing them real customer records.

A third mode used to exist — the original Express and SQLite build that ran on the office
LAN. It was removed in August 2026, after the cloud version had replaced it everywhere. Git
history still has it.

### The database

Schema lives in `supabase/migrations` and is applied in filename order. The CLI talks to the
hosted project directly; Docker is only needed for `supabase start` and for `db diff`.

```
npx supabase migration list --linked    # what is applied, what is pending
npx supabase db push                    # apply the pending ones
```

Changing the schema means regenerating the types the app compiles against:

```
npx supabase gen types typescript --linked > web/src/types/database.generated.ts
```

Never edit that file. `web/src/types/database.ts` gives the generated shapes the short names
the code uses, and documents the few places where the schema is vaguer than the app needs.

### Edge Functions

`supabase/functions` holds six Deno functions. `tms-gateway` is the only route to the
corporate TMS and the only one worth reading in full before changing anything — its header
lists eight constraints that exist for reasons, several of them learned the hard way.

```
npx supabase functions deploy tms-gateway --use-api
```

`--use-api` builds on Supabase's side, which is what lets this work without Docker.

**Apply migrations before deploying a function that depends on a new table.** Doing it the
other way round takes production down for the length of the gap.

### Deploying the web app

Pushing to `main` builds and publishes to GitHub Pages. `VITE_BASE` is set in the workflow
because the site is served from a subpath, and the two Supabase values come from repository
variables.

## Checks

```
npm run typecheck
npm test
```

The suite is accessibility-focused: it renders the real screens and asserts they stay usable
by keyboard and screen reader. It does not yet cover business logic, which is the largest
known gap in the test story.


## Status

In production use by the company's fleet, with the driver app, delivery evidence, live
tracking and TMS intake all running daily.
