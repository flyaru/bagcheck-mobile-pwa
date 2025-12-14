# BagCheck Mobile + Smart Dimension Scan for Air Arabia

## Overview

**Objective.** Build a mobile‑first progressive web application (PWA) that allows Air Arabia ground staff to scan boarding‑passes and bag tags and to accurately measure the dimensions of cabin bags with the device camera.  The application should decide in under **one second** whether a bag is approved, refused or placed on hold and must operate reliably offline, under poor lighting conditions and with intermittent connectivity.  The system is role‑based (agent, supervisor and admin), provides an audit trail for each bag and supports English and Arabic interfaces in dark mode.

## Functional architecture

### Components

| Layer           | Responsibility |
|-----------------|----------------|
| **Mobile PWA** (React + TypeScript) | Provides the user interface for agents and supervisors. Features include scanning boarding‑passes and bag tags via the camera (QR, PDF417 or 1D barcodes), guiding the user through dimension measurements, applying the rules engine and displaying decisions. A service worker caches assets and provides an offline data queue for later sync. |
| **Vision module** (client side) | Written in TypeScript/WebAssembly using OpenCV.js and optionally TensorFlow.js. Performs segmentation of the bag and reference object, calibrates pixels‑per‑metric, computes length/width/height, estimates confidence and triggers auto‑capture when alignment is good. Supports AR depth via WebXR when available. |
| **Backend API** (Supabase) | Provides data storage, authentication and serverless functions. The database stores flights, boarding‑passes, rules, users, devices, bag‑scan records and audit logs. Storage buckets hold compressed reference images. Supabase Row Level Security (RLS) enforces role‑based access. |
| **Rules engine** | A Postgres table stores dimension rules per route/flight/cabin with tolerances. A stored procedure/function applies rules to measured dimensions and returns a decision (APPROVED, REFUSED, HOLD) with reason codes. |
| **Admin console** | Accessible in the same PWA but gated by admin role. Allows configuration of rules and thresholds, viewing analytics and exporting CSVs. |
| **Dashboards** | Real‑time dashboards show flight‑level bag counts (approved/refused/hold), dimension violations and common oversize trends. Supabase `realtime` channels push updates to dashboards. |

### End‑to‑end workflow

1. **Flight selection:** The agent selects a flight from a cached list or scans the passenger’s boarding‑pass (QR/PDF417).  The scan resolves the flight number, date and cabin class.  Duplicate boarding‑pass usage or wrong flight/time are flagged.
2. **Boarding‑pass scan:** The app reads the barcoded PNR and extracts passenger name, flight, allowed bag count and special flags (e.g., stroller, fragile, medical).  It validates that the flight is still open (gate closing times are configurable).
3. **Bag tag scan:** The agent scans the bag tag (1D/2D barcode).  The system checks whether the tag has already been used for this flight; duplicate tags are refused.
4. **Dimension scan:** The app displays overlay prompts (“Place bag flat”, “Include reference card”).  It captures two images:
   - **Top view:** detects the bag and reference object, computes **length (L)** and **width (W)**.
   - **Side view:** detects the height (H).  If the device supports depth sensors (WebXR/ARCore/ARKit), depth is used to estimate height; otherwise, a second image with the reference object upright is taken.
   The module calculates pixel‑to‑centimetre ratio using the reference object and outputs dimensions with a confidence score.  If confidence is below a threshold, the scan is marked **HOLD**.
5. **Decision screen:** The app retrieves applicable dimension rules for the flight/route/cabin and compares measured values against allowed limits (with tolerance).  It also checks bag count, duplicate tags and special flags.  The result is displayed as a large green (APPROVED), red (REFUSED) or amber (HOLD) screen.  Reasons (e.g. “Exceeded height limit”) are highlighted in red.
6. **Confirmation:** With a single tap, the agent confirms the decision; the record (bag tag, boarding‑pass ID, measurements, confidence, decision, operator/device/time/location, reference image) is immediately stored in local IndexedDB.  When connectivity is available, queued records are synced to Supabase.  No data is lost during offline operation.

## Dimension detection algorithm

### Measurement approach

**Reference object method (primary).**  To obtain real‑world measurements from a monocular camera, the system uses a **reference object of known size** placed next to the bag.  PyImageSearch notes that accurate size measurement requires a calibration using a reference object with known dimensions that is uniquely identifiable in the scene【671653280228293†L118-L131】.  The reference must be easy to find—for example, a standardized Air Arabia sizing card or an A4 paper with a distinct pattern.  Once detected, the algorithm computes a pixel‑per‑centimetre ratio and uses it to convert the bag’s pixel dimensions to centimetres.

Steps:

1. **Detect reference object and bag.**  Use OpenCV.js to convert the frame to grayscale, apply Gaussian blur, perform edge detection and find contours.  The reference object is identified by its shape/marker (e.g., QR code on the sizing card); its bounding box gives a known width (e.g., 21 cm for A4).  The bag is segmented via instance segmentation (a pre‑trained lightweight model loaded via TensorFlow.js or ONNX runtime) to obtain the polygon of its outline.
2. **Compute pixel‑per‑metric ratio.**  If the reference object’s width in pixels is `ref_width_px` and its known physical width is `ref_width_cm`, the ratio is `px_per_cm = ref_width_px / ref_width_cm`.  PyImageSearch’s example computes `pixels_per_metric` by dividing the pixel width of the reference by its actual width【671653280228293†L150-L165】.
3. **Measure length and width.**  From the segmented bag polygon, find the extreme points (top‑left, top‑right, bottom‑right, bottom‑left) and calculate the distances between corners using Euclidean distance.  Divide these pixel distances by `px_per_cm` to obtain L and W.
4. **Measure height.**  Ask the agent to capture a side view with the reference object upright.  Detect the top and bottom of the bag and compute the vertical pixel distance.  Convert to centimetres using the same `px_per_cm`.  Alternatively, if the device provides depth (e.g., WebXR’s `XRFrame.getDepthInformation`), obtain depth values for the top and bottom of the bag and subtract to derive height【788369427645324†L210-L236】.
5. **Confidence estimation.**  Confidence is derived from segmentation quality (e.g., mask area vs. convex hull), reference detection certainty and consistency between measurements.  If the confidence falls below an admin‑defined threshold, the scan result is set to **HOLD**.

**Bounding‑box and depth fallback.**  In poor lighting or when the reference object is not recognised, a bounding‑box‑only method estimates dimensions by assuming the bag occupies most of the frame and approximating pixel‑per‑cm using average camera intrinsic parameters.  Devices supporting ARCore/ARKit provide depth maps; the algorithm can calculate distances between corner points directly, reducing perspective distortion【788369427645324†L210-L236】.

**Operational guidance.**  The UI overlays guides on the camera view instructing staff to place the bag flat, ensure the entire bag and reference card are visible and avoid occlusions.  The app automatically triggers the capture when alignment is correct, but supervisors can manually override or input dimensions.  If the device orientation or lighting prevents reliable measurement, the app prompts the agent to adjust conditions.

### Limitations and mitigation

* **Perspective distortion:**  The accuracy of the reference‑object method declines if the bag and reference are not in the same plane or if the camera is tilted【788369427645324†L204-L207】.  To mitigate, the UI guides users to keep the phone perpendicular to the bag and align the sizing card next to it.  Optionally, compute homography to correct perspective.
* **Distance to the object:**  The reference object needs to be close to the bag; otherwise the pixel:centimetre ratio is miscalculated【788369427645324†L204-L207】.  The app instructs agents to place the card touching the bag.
* **Height measurement:**  Without depth sensors, measuring height requires an additional capture from the side.  AR‑enabled devices automatically use depth to compute height in a single capture.

## Configurable rules engine

Dimension rules vary by **route**, **flight** and **cabin**.  A `dimension_rules` table stores:

| Field | Type | Description |
|------|------|-------------|
| `id` (PK) | UUID | Unique rule identifier |
| `route_origin` | VARCHAR | IATA code of origin (e.g., `SHJ`) |
| `route_destination` | VARCHAR | IATA code of destination (e.g., `TUN`) |
| `flight_number` | VARCHAR | Specific flight number (nullable) |
| `cabin` | VARCHAR | `cabin_bag` or `checked_bag` |
| `max_length_cm` | NUMERIC | Maximum permitted length |
| `max_width_cm` | NUMERIC | Maximum permitted width |
| `max_height_cm` | NUMERIC | Maximum permitted height |
| `max_linear_cm` | NUMERIC | Maximum total (L + W + H) |
| `tolerance_cm` | NUMERIC | Allowed tolerance (e.g. 2 cm) |
| `max_bags` | INTEGER | Number of bags allowed per boarding‑pass |
| `max_weight_kg` | NUMERIC | Weight limit if captured |
| `active_from`/`active_to` | TIMESTAMP | Validity period |
| `created_by` | UUID | Admin user ID |
| `created_at` | TIMESTAMP | Audit timestamp |

When a bag is scanned, a stored procedure receives the measured dimensions and flight context, fetches the most specific applicable rule (flight‑level overrides route‑level).  The decision logic is:

1. **Within limits:** If `L ≤ max_length + tolerance`, `W ≤ max_width + tolerance`, `H ≤ max_height + tolerance` (and optionally `L+W+H ≤ max_linear + tolerance`) **and** bag count ≤ `max_bags`, then return **APPROVED**.
2. **Exceeds limits:** If any dimension exceeds `max + tolerance`, return **REFUSED** with reason **DIMENSIONS**.
3. **Borderline / low confidence:** If dimensions fall within the tolerance band (e.g., exactly at the limit) or the vision module’s confidence is below threshold, return **HOLD** for manual review.
4. **Other refusals:** Duplicate tag, invalid boarding‑pass, flight closed, overweight or flagged special baggage produce specific refusal reasons.

Admins manage rules via the console.  All rule changes are logged with user ID and timestamp.

## Database schema (SQL)

The following simplified schema can be deployed on Supabase (Postgres).  Primary keys are UUIDs (generated on the client or server).  RLS policies restrict row access to authorised roles.

```sql
-- Users table: agents, supervisors, admins
create table users (
  id uuid primary key default uuid_generate_v4(),
  email varchar not null unique,
  full_name varchar,
  role varchar check (role in ('agent','supervisor','admin')) not null,
  created_at timestamp default now()
);

-- Devices table
create table devices (
  id uuid primary key default uuid_generate_v4(),
  device_uid varchar not null unique, -- OS/device identifier
  model varchar,
  os varchar,
  registered_by uuid references users(id),
  created_at timestamp default now()
);

-- Flights table (simplified)
create table flights (
  id uuid primary key default uuid_generate_v4(),
  flight_number varchar not null,
  departure_date date not null,
  departure_time time,
  arrival_time time,
  origin varchar(3) not null,
  destination varchar(3) not null,
  status varchar check (status in ('scheduled','boarding','closed','departed')),
  created_at timestamp default now()
);

-- Boarding passes (one per passenger)
create table boarding_passes (
  id uuid primary key default uuid_generate_v4(),
  flight_id uuid references flights(id) on delete cascade,
  pnr varchar not null,
  passenger_name varchar,
  cabin varchar check (cabin in ('economy','business','first','special')),
  allowed_bags integer default 1,
  special_flags jsonb, -- stroller, fragile, medical etc.
  scanned_at timestamp, -- when scanned by agent
  created_at timestamp default now(),
  unique (flight_id, pnr)
);

-- Dimension rules (see description above)
create table dimension_rules (
  id uuid primary key default uuid_generate_v4(),
  route_origin varchar(3),
  route_destination varchar(3),
  flight_number varchar,
  cabin varchar,
  max_length_cm numeric,
  max_width_cm numeric,
  max_height_cm numeric,
  max_linear_cm numeric,
  tolerance_cm numeric default 0,
  max_bags integer default 1,
  max_weight_kg numeric,
  active_from timestamp,
  active_to timestamp,
  created_by uuid references users(id),
  created_at timestamp default now()
);

-- Baggage scans (one record per bag)
create table bags (
  id uuid primary key default uuid_generate_v4(),
  bag_tag varchar not null,
  boarding_pass_id uuid references boarding_passes(id) on delete cascade,
  length_cm numeric,
  width_cm numeric,
  height_cm numeric,
  linear_cm numeric,
  allowed_length_cm numeric,
  allowed_width_cm numeric,
  allowed_height_cm numeric,
  allowed_linear_cm numeric,
  confidence numeric,
  decision varchar check (decision in ('APPROVED','REFUSED','HOLD')),
  reason varchar,
  reference_image_url varchar,
  operator_id uuid references users(id),
  device_id uuid references devices(id),
  location varchar,
  overridden_by uuid references users(id),
  override_reason varchar,
  scanned_at timestamp default now(),
  synced boolean default false
);

-- Audit logs for overrides and admin actions
create table audit_logs (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references users(id),
  action varchar, -- e.g. 'override', 'rule_create'
  target_id uuid,
  details jsonb,
  created_at timestamp default now()
);
```

This schema can be extended with weight measurements, location coordinates (latitude/longitude) and additional metadata.  IndexedDB stores unsynced records on the device; when syncing, the `synced` flag is set to `true`.

## API definitions

Endpoints are defined using REST (could also be GraphQL).  All requests are authenticated via Supabase JWT.  The following examples show request/response structures (JSON).  Only required fields are shown.

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/auth/login` | Authenticate user; returns JWT and role. |
| `POST` | `/auth/logout` | Invalidate token. |

### Flight & boarding‑pass

| Method | Endpoint | Input | Response |
|--------|---------|--------|----------|
| `GET` | `/flights?date=YYYY‑MM‑DD` | list flights for the date. | Array of flights with id, flight number, route, status and gate. |
| `GET` | `/boarding-pass/{barcode}` | Barcode string (QR/PDF417) scanned from boarding‑pass. | Returns `boarding_pass` record with passenger name, flight ID, cabin, allowed bag count, special flags. |
| `GET` | `/bag-tag/{tag}` | Bag tag number. | Returns existing bag record if scanned; used to detect duplicates. |

### Bag scanning

| Method | Endpoint | Input | Response |
|--------|----------|--------|---------|
| `POST` | `/bag-scan` | JSON with `boarding_pass_id`, `bag_tag`, `length_cm`, `width_cm`, `height_cm`, `confidence`, `reference_image` (binary), `device_id`. | Returns decision: APPROVED/REFUSED/HOLD with reason.  The server looks up rules, bag counts and duplicates and stores the record. |
| `PATCH` | `/bag/{bag_id}/override` | Supervisor inputs new dimensions or decision along with `override_reason`. | Returns updated bag record and logs override. |

### Rules management (Admin only)

| Method | Endpoint | Input | Response |
|--------|----------|--------|---------|
| `GET` | `/rules?route_origin=XXX&route_destination=YYY&cabin=cabin_bag` | fetch active rules. | Array of rules with tolerance and limits. |
| `POST` | `/rules` | JSON body describing a new rule. | Returns created rule. |
| `PUT` | `/rules/{id}` | Modify existing rule. | Returns updated rule. |

### Analytics & dashboards

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/dashboard/flight/{flight_id}` | Real‑time counts of approved/refused/hold bags, bag count vs. allowance and dimension violation types. |
| `GET` | `/analytics/oversize?start_date=…&end_date=…` | Heatmap of common oversize dimensions (e.g. top violated dimension and distribution). |
| `GET` | `/export/flight/{flight_id}` | Returns CSV of all bag scans for the flight. |

## Code structure

### Front‑end (React + TypeScript)

```
src/
  api/
    client.ts             # wrapper around fetch with JWT and offline queue
    flights.ts            # functions to call flight endpoints
    rules.ts              # functions to fetch rules
    bags.ts               # functions to post bag scans and overrides

  components/
    FlightSelector.tsx    # list or scan flight
    BoardingPassScanner.tsx # uses camera to scan QR/PDF417 codes
    BagTagScanner.tsx     # 1D/2D barcode scanning
    DimensionScanner.tsx  # vision module integration; displays overlay and triggers auto‑capture
    DecisionScreen.tsx    # shows APPROVED/REFUSED/HOLD with details
    OfflineQueue.tsx      # monitors unsynced scans and shows sync status
    AdminDashboard.tsx    # analytics and rules management (role‑protected)

  hooks/
    useCamera.ts          # obtains camera stream and handles permissions
    useDimensionDetection.ts # wraps OpenCV.js/TensorFlow.js to detect bag and reference object
    useOfflineSync.ts      # manages IndexedDB and sync queue

  utils/
    barcode.ts            # decode various barcode formats (e.g., using zxing library)
    i18n.ts               # English/Arabic translations and RTL support
    rules.ts              # evaluate dimensions vs rules on client (for offline provisional decision)

  pages/
    AgentHome.tsx
    SupervisorHome.tsx
    AdminHome.tsx
    Login.tsx

  App.tsx                # top‑level routing and role‑based guards
  index.tsx              # service worker registration and PWA manifest
```

### Vision module

* `vision/detectReference.ts` – uses OpenCV.js to detect the reference card via contour matching or ArUco marker detection.
* `vision/detectBag.ts` – performs instance segmentation of the bag; can load a lightweight model (e.g., YOLOv8‑Nano) converted to ONNX and executed via ONNX Runtime Web.
* `vision/measure.ts` – computes pixel distances between extreme points, applies pixel‑per‑cm ratio, estimates L/W/H and calculates a confidence score.
* `vision/depth.ts` – interfaces with WebXR depth API if available to compute height.

### Backend functions (Supabase Edge Functions or Node server)

* `functions/bag-scan.ts` – receives measurements, looks up rules, checks duplicate tags and bag counts, decides and inserts record into `bags` table.
* `functions/get-rules.ts` – queries `dimension_rules` for the given route/flight/cabin and returns active rule.
* `functions/override.ts` – supervisor override; updates `bags` record and logs action.
* `functions/dashboard.ts` – aggregates bag counts per flight using Postgres `materialized views` or real‑time channels.

## Deployment steps

1. **Set up Supabase.**  Create a Supabase project, enable email/SMS login and configure JWT settings.  Run the SQL schema above via the SQL editor.  Set up storage bucket `reference-images` with public read (signed URLs only).  Define RLS policies to restrict table access based on user role (e.g., agents can insert into `bags` but cannot update; admins can manage rules; supervisors can override).  Configure real‑time channels for `bags` to support live dashboards.
2. **Train vision model.**  Collect images of cabin bags placed beside the Air Arabia sizing card.  Label bag and card polygons.  Train an instance segmentation model (e.g., YOLOv8 Seg or Mask R‑CNN).  Export the model to ONNX or TensorFlow.js.  Host the model in the PWA assets or use a lightweight API if client devices cannot handle inference.
3. **Develop the PWA.**  Bootstrap a React app with TypeScript, TailwindCSS and service worker support (e.g., using Vite or Create React App).  Implement components as outlined.  Integrate OpenCV.js and the trained model via WebAssembly.  Implement IndexedDB storage for offline data and a sync queue that retries until successful.
4. **Configure environment variables.**  Store Supabase URL, anon/public keys and model URLs in environment variables.  Use `.env` files and build environment for production.
5. **Deploy front‑end.**  Host the PWA on Vercel, Netlify or Supabase Static Hosting.  Ensure the site is served over HTTPS (required for camera access).  Add a `manifest.json` and service worker to enable installation on mobile devices.
6. **Monitoring and logging.**  Enable Supabase logs and set up alerts for rule changes, override events and high refusal rates.  Use Supabase Edge Functions to push notifications or send emails for critical events.

## Edge cases & failure handling

1. **Poor lighting / reflections.**  Use auto‑exposure and HDR where available; instruct users to reposition.  If the reference card cannot be detected, prompt to retake the scan or fall back to bounding‑box estimation with lower confidence.
2. **Partial bag in frame.**  The vision module ensures the bag contour is closed; if not, ask the user to reposition until the entire bag is visible.
3. **Reference card missing.**  Without a reference, the pixel‑per‑cm ratio cannot be determined.  The app flags the scan as **HOLD** and instructs the agent to place the sizing card.  Supervisors may manually enter dimensions.
4. **Duplicate bag tags.**  If the same bag tag is scanned twice for a flight, the decision is **REFUSED** with reason “DUPLICATE TAG”.  Optionally allow supervisors to override if legitimately re‑scanning.
5. **Boarding‑pass mismatch.**  If the flight in the boarding‑pass does not match the selected flight or if the gate is closed, the bag is refused with reason “FLIGHT MIS‑MATCH” or “GATE CLOSED”.
6. **Offline sync conflicts.**  If two devices scan the same bag offline and later sync, the server resolves duplicates based on timestamp or applies a conflict‑resolution policy (e.g. first come first served, or require manual reconciliation).
7. **Failure of model inference.**  If the segmentation model fails to load or the device lacks the computational power, provide an option for manual measurement input (supervisors only).
8. **Accessibility / localisation.**  The UI toggles between English and Arabic.  Text direction switches to RTL for Arabic.  Provide large buttons, haptic feedback and audible cues for key actions.

## One‑page staff quick guide

**Purpose:** Ensure cabin bags meet Air Arabia’s size rules (55 cm × 40 cm × 20 cm including handles and wheels【385646527653635†L122-L136】).  Each passenger may carry one bag (7 kg) plus a personal item (3 kg).  Over‑sized bags must be checked.

1. **Select the flight or scan the boarding‑pass.**  The app will show passenger details and allowed bag count.  Verify that the flight number and date match.
2. **Scan the bag tag.**  Hold the camera steady over the bag tag barcode.  If the tag has already been scanned for this flight, the app will refuse the bag.  Ask a supervisor for assistance if necessary.
3. **Place the bag on the measurement mat.**  Lay the bag flat and put the Air Arabia sizing card or A4 paper next to it.  Make sure both the bag and the card are fully visible.  Tap **Scan Dimensions**.
4. **Follow the on‑screen guides.**  Align the phone as instructed.  The app will automatically capture two photos when alignment is good.  You will feel a vibration and hear a beep.
5. **View the decision.**  The screen will show a large green (approved), red (refused) or amber (hold) indicator.  It also lists the measured dimensions, allowed limits and the bag count.  If **REFUSED**, the exceeded dimension is highlighted in red.  If **HOLD**, call a supervisor for manual review.
6. **Confirm.**  Tap **Confirm** to save the record.  Even if there is no internet connection, the record will be saved locally and synced later.  Do **not** scan the same bag again.  Attach the printed label (optional) and instruct the passenger accordingly.
7. **Escalate edge cases.**  For special baggage (strollers, fragile or medical equipment) or suspected errors (e.g. reference card not detected), contact a supervisor.  Supervisors can override decisions and manually enter dimensions; all overrides are logged.

By following this workflow, ground staff can ensure consistent, fast and audit‑able cabin‑bag checks.  The system is designed to be intuitive, offline‑capable and robust to typical operational challenges while adhering to Air Arabia’s baggage policies.
