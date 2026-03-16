import express from "express";
import path from "path";
import cors from "cors";
import mongoose from "mongoose";
import rateLimit from "express-rate-limit";
import "dotenv/config";

const app = express();
app.set("trust proxy", 1);
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(process.cwd(), "public")));

// ── MongoDB connection ────────────────────────────────────────────────────────
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("Connected to MongoDB"))
  .catch(err => console.error("MongoDB connection error:", err));

// ── Note schema ───────────────────────────────────────────────────────────────
const noteSchema = new mongoose.Schema({
  locked:    { type: Boolean, default: false },
  title:     { type: String, required: true },
  content:   { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

const Note = mongoose.model("Note", noteSchema);

// ── Seed locked notes if DB is empty ─────────────────────────────────────────
const seed = async () => {
  try {
    const count = await Note.countDocuments();
    if (count === 0) {
      await Note.insertMany([
        { locked: true, title: "Welcome to QuickNotes", content: "This is a shared demo app. Add your own notes using the form above." },
        { locked: true, title: "How it works", content: "Type a title and content, then click Add Note. Notes are visible to everyone visiting this page." }
      ]);
      console.log("Seeded default notes");
    }
  } catch (err) {
    console.error("Seed error:", err);
  }
};
seed();

// ── Rate limiters ─────────────────────────────────────────────────────────────
const getLimiter = rateLimit({
  windowMs: 60 * 1000, max: 60,
  standardHeaders: true, legacyHeaders: false,
  message: { error: "Too many requests, please try again later." }
});

const createLimiter = rateLimit({
  windowMs: 60 * 1000, max: 20,
  standardHeaders: true, legacyHeaders: false,
  message: { error: "Too many notes created, slow down." }
});

const mutateLimiter = rateLimit({
  windowMs: 60 * 1000, max: 30,
  standardHeaders: true, legacyHeaders: false,
  message: { error: "Too many requests, please try again later." }
});

// ── Routes ────────────────────────────────────────────────────────────────────

// GET all notes
app.get("/api/notes", getLimiter, async (req, res) => {
  try {
    const notes = await Note.find().sort({ createdAt: 1 });
    res.json(notes);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch notes" });
  }
});

// GET note by ID
app.get("/api/notes/:id", getLimiter, async (req, res) => {
  try {
    const note = await Note.findById(req.params.id);
    if (!note) return res.status(404).json({ error: "Note not found" });
    res.json(note);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch note" });
  }
});

// POST create note
app.post("/api/notes", createLimiter, async (req, res) => {
  try {
    const { title, content } = req.body;
    if (!title || !content) return res.status(400).json({ error: "Missing title or content" });
    const note = await Note.create({ title, content });
    res.status(201).json(note);
  } catch (err) {
    res.status(500).json({ error: "Failed to create note" });
  }
});

// PUT update note
app.put("/api/notes/:id", mutateLimiter, async (req, res) => {
  try {
    const note = await Note.findById(req.params.id);
    if (!note) return res.status(404).json({ error: "Note not found" });
    if (note.locked) return res.status(403).json({ error: "This note cannot be edited" });

    const { title, content } = req.body;
    if (title) note.title = title;
    if (content) note.content = content;
    await note.save();
    res.json(note);
  } catch (err) {
    res.status(500).json({ error: "Failed to update note" });
  }
});

// DELETE note
app.delete("/api/notes/:id", mutateLimiter, async (req, res) => {
  try {
    const note = await Note.findById(req.params.id);
    if (!note) return res.status(404).json({ error: "Note not found" });
    if (note.locked) return res.status(403).json({ error: "This note cannot be deleted" });

    await note.deleteOne();
    res.json({ message: "Note deleted" });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete note" });
  }
});

// CLEANUP — called by cron job
app.get("/api/cleanup", async (req, res) => {
  try {
    const result = await Note.deleteMany({ locked: false });
    console.log(`Cleanup ran every 6 hours — ${result.deletedCount} notes removed`);
    res.json({ message: "Cleanup complete", deleted: result.deletedCount });
  } catch (err) {
    res.status(500).json({ error: "Cleanup failed" });
  }
});

// Fallback
app.get("/{*path}", (req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

export default app;