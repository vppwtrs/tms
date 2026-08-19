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

**Trips arrive on their own.** Confirmed trips flow in every few minutes. If the system
already knows who each driver name refers to, the job goes straight to that driver's phone.
If a name is new, the trip waits for a planner to answer *who is this* — once. The answer is
remembered, and the next trip for that driver needs no answer at all.

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

## Status

In production use by the company's fleet, with the driver app, delivery evidence, live
tracking and TMS intake all running daily.
