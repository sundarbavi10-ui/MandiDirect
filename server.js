const express = require("express");
const path = require("path");
const cors = require("cors");
const Database = require("better-sqlite3");
const db = new Database("mandidirect.db");
db.prepare(`
  CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    listingId INTEGER NOT NULL,
    createdAt TEXT NOT NULL,
    status TEXT NOT NULL
  )
`).run();
db.prepare(`
  CREATE TABLE IF NOT EXISTS deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requestId INTEGER NOT NULL,
    status TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )
`).run();
db.prepare(`
  CREATE TABLE IF NOT EXISTS listings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    crop TEXT,
    seller TEXT NOT NULL,
    location TEXT NOT NULL,
    distance REAL DEFAULT 0,
    status TEXT,
    quantity TEXT NOT NULL,
    price REAL NOT NULL
  )
`).run();
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Demo in-memory data.
// Later this can be replaced with MongoDB/MySQL/PostgreSQL.

function parseQuantity(value) {
  const match = String(value).toLowerCase().match(/[\d.]+/);
  if (!match) return 0;
  const number = Number(match[0]);
  if (String(value).toLowerCase().includes("tonne")) return number * 1000;
  return number;
}

// GET all listings / search listings
app.get("/api/listings", (req, res) => {
  const search = String(req.query.search || "").trim().toLowerCase();

  let result;

  if (search) {
    result = db.prepare(`
      SELECT * FROM listings
      WHERE LOWER(name || ' ' || crop || ' ' || seller || ' ' || location)
      LIKE ?
      ORDER BY id DESC
    `).all(`%${search}%`);
  } else {
    result = db.prepare(`
      SELECT * FROM listings
      ORDER BY id DESC
    `).all();
  }

  res.json({ listings: result });
});
// GET one listing
app.get("/api/listings/:id", (req, res) => {
  const listing = db.prepare(`
    SELECT * FROM listings WHERE id = ?
  `).get(Number(req.params.id));

  if (!listing) {
    return res.status(404).json({ error: "Listing not found" });
  }

  res.json({ listing });
});
// POST new listing
app.post("/api/listings", (req, res) => {
  const { name, seller, location, quantity, price } = req.body;

  if (!name || !seller || !location || !quantity || price === undefined) {
    return res.status(400).json({
      error: "name, seller, location, quantity and price are required"
    });
  }

  const crop = name.toLowerCase().includes("tomato") ? "tomato" :
               name.toLowerCase().includes("onion") ? "onion" :
               name.toLowerCase().includes("mango") ? "mango" :
               name.toLowerCase().includes("banana") ? "banana" :
               name.toLowerCase().includes("spinach") ? "spinach" :
               name.toLowerCase().includes("carrot") ? "carrot" : "";

  const result = db.prepare(`
    INSERT INTO listings
    (name, crop, seller, location, distance, status, quantity, price)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name,
    crop,
    seller,
    location,
    0,
    "Ready today",
    quantity,
    Number(price)
  );

  const listing = db.prepare(`
    SELECT * FROM listings WHERE id = ?
  `).get(result.lastInsertRowid);

  res.status(201).json({
    message: "Listing published successfully",
    listing
  });
});
// POST buyer request
app.post("/api/listings/:id/requests", (req, res) => {
  const listingId = Number(req.params.id);

  const listing = db.prepare(`
    SELECT * FROM listings WHERE id = ?
  `).get(listingId);

  if (!listing) {
    return res.status(404).json({ error: "Listing not found" });
  }

  const result = db.prepare(`
    INSERT INTO requests (listingId, createdAt, status)
    VALUES (?, ?, ?)
  `).run(
    listingId,
    new Date().toISOString(),
    "pending"
  );

  res.status(201).json({
    message: "Request sent successfully",
    request: {
      id: result.lastInsertRowid,
      listingId,
      status: "pending"
    }
  });
});
app.post("/api/deliveries", (req, res) => {
  const { requestId } = req.body;

  if (!requestId) {
    return res.status(400).json({
      error: "requestId is required"
    });
  }

  const request = db.prepare(`
    SELECT * FROM requests WHERE id = ?
  `).get(Number(requestId));

  if (!request) {
    return res.status(404).json({
      error: "Request not found"
    });
  }

  const result = db.prepare(`
    INSERT INTO deliveries (requestId, status, updatedAt)
    VALUES (?, ?, ?)
  `).run(
    Number(requestId),
    "Pickup Scheduled",
    new Date().toISOString()
  );

  res.status(201).json({
    message: "Delivery created",
    delivery: {
      id: result.lastInsertRowid,
      requestId: Number(requestId),
      status: "Pickup Scheduled"
    }
  });
});


app.get("/api/deliveries/:requestId", (req, res) => {
  const delivery = db.prepare(`
    SELECT * FROM deliveries
    WHERE requestId = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(Number(req.params.requestId));

  if (!delivery) {
    return res.status(404).json({
      error: "Delivery not found"
    });
  }

  res.json({ delivery });
});
app.get("/api/demand-prediction", (req, res) => {
  const demand = {
    tomato: { level: "High", recommendedKg: 150 },
    onion: { level: "Medium", recommendedKg: 100 },
    mango: { level: "High", recommendedKg: 120 },
    banana: { level: "Medium", recommendedKg: 80 }
  };

  res.json({ demand });
});
app.get("/api/market-prices", (req, res) => {
  const marketPrices = {
    tomato: 40,
    onion: 35,
    mango: 80,
    banana: 45,
    spinach: 30,
    carrot: 50
  };

  res.json({ marketPrices });
});
// Dashboard statistics
app.get("/api/stats", (req, res) => {
  const activeSupply = db.prepare(`
    SELECT COUNT(*) AS count FROM listings
  `).get().count;

  const openRequests = db.prepare(`
    SELECT COUNT(*) AS count
    FROM requests
    WHERE status = 'pending'
  `).get().count;

  const listings = db.prepare(`
    SELECT quantity FROM listings
  `).all();

  const totalAvailableKg = listings.reduce(
    (sum, item) => sum + parseQuantity(item.quantity),
    0
  );

  const totalLotRequests = db.prepare(`
    SELECT COUNT(*) AS count FROM requests
  `).get().count;

  res.json({
    activeSupply,
    openRequests,
    totalAvailableKg,
    totalLotRequests
  });
});
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "SIH.HTML"));
});
app.get("/api/requests", (req, res) => {
  const requests = db.prepare(`
    SELECT
      requests.id,
      requests.listingId,
      requests.createdAt,
      requests.status,
      listings.name,
      listings.seller,
      listings.location,
      listings.quantity,
      listings.price
    FROM requests
    JOIN listings ON listings.id = requests.listingId
    ORDER BY requests.id DESC
  `).all();

  res.json({ requests });
});
app.patch("/api/requests/:id", (req, res) => {
  const requestId = Number(req.params.id);
  const { status } = req.body;

  if (!["accepted", "rejected"].includes(status)) {
    return res.status(400).json({
      error: "Status must be accepted or rejected"
    });
  }

  const result = db.prepare(`
    UPDATE requests
    SET status = ?
    WHERE id = ?
  `).run(status, requestId);

  if (result.changes === 0) {
    return res.status(404).json({
      error: "Request not found"
    });
  }

  res.json({
    message: `Request ${status}`,
    requestId,
    status
  });
});
app.listen(PORT, () => {
  console.log(`MandiDirect backend running at http://localhost:${PORT}`);
});