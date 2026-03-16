import express from "express";
import fs from "fs";
import path from "path";
import cors from "cors";
import rateLimit from "express-rate-limit";

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(process.cwd(), "public")));

const dataPath = path.join(process.cwd(), "data", "notes.json");

const readNotes = () => {
  try {
    return JSON.parse(fs.readFileSync(dataPath, "utf8"));
  } catch {
    return [
      { id: 1, locked: true, title: "Welcome to QuickNotes", content: "This is a shared demo app. Add your own notes using the form above.", createdAt: "2024-01-01T00:00:00.000Z" },
      { id: 2, locked: true, title: "How it works", content: "Type a title and content, then click Add Note. Notes are visible to everyone visiting this page.", createdAt: "2024-01-01T00:00:00.000Z" }
    ];
  }
};

const writeNotes = (notes) => {
  try {
    fs.mkdirSync(path.dirname(dataPath), { recursive: true });
    fs.writeFileSync(dataPath, JSON.stringify(notes, null, 2));
  } catch (err) {
    console.error("Write error:", err);
  }
};

// Rate limiters
const getLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 60,              // 60 GET requests per minute per IP
  message: { error: "Too many requests, please try again later." }
});

const createLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 20,              // 20 new notes per minute per IP
  message: { error: "Too many notes created, slow down." }
});

const mutateLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 30,              // 30 edits/deletes per minute per IP
  message: { error: "Too many requests, please try again later." }
});

// Auto cleanup every 2 hours
let lastCleanup = Date.now();

const cleanup = () => {
  const now = Date.now();
  if (now - lastCleanup < 20 * 60 * 1000) return; // 20 minutes
  const notes = readNotes();
  const locked = notes.filter(n => n.locked);
  writeNotes(locked);
  lastCleanup = now;
  console.log("Cleanup ran — user notes cleared");
};

app.use((req, res, next) => {
  cleanup();
  next();
});

// GET all notes
app.get("/api/notes", getLimiter, (req, res) => {
  res.json(readNotes());
});

// GET note by ID
app.get("/api/notes/:id", getLimiter, (req, res) => {
  const notes = readNotes();
  const note = notes.find(n => n.id === parseInt(req.params.id));
  if (!note) return res.status(404).json({ error: "Note not found" });
  res.json(note);
});

// POST create note
app.post("/api/notes", createLimiter, (req, res) => {
  const notes = readNotes();
  const { title, content } = req.body;
  if (!title || !content) return res.status(400).json({ error: "Missing title or content" });

  const newNote = {
    id: notes.length ? Math.max(...notes.map(n => n.id)) + 1 : 1,
    locked: false,
    title,
    content,
    createdAt: new Date()
  };
  notes.push(newNote);
  writeNotes(notes);
  res.status(201).json(newNote);
});

// PUT update note
app.put("/api/notes/:id", mutateLimiter, (req, res) => {
  const notes = readNotes();
  const note = notes.find(n => n.id === parseInt(req.params.id));
  if (!note) return res.status(404).json({ error: "Note not found" });
  if (note.locked) return res.status(403).json({ error: "This note cannot be edited" });

  const { title, content } = req.body;
  note.title = title || note.title;
  note.content = content || note.content;
  writeNotes(notes);
  res.json(note);
});

// DELETE note
app.delete("/api/notes/:id", mutateLimiter, (req, res) => {
  let notes = readNotes();
  const note = notes.find(n => n.id === parseInt(req.params.id));
  if (!note) return res.status(404).json({ error: "Note not found" });
  if (note.locked) return res.status(403).json({ error: "This note cannot be deleted" });

  notes = notes.filter(n => n.id !== parseInt(req.params.id));
  writeNotes(notes);
  res.json({ message: "Note deleted" });
});

// Fallback — serve index.html for any unmatched route
app.get("/{*path}", (req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

export default app;