// server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { InferenceClient } = require("@huggingface/inference");
const { MongoClient, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// MongoDB Atlas connection
const uri = `mongodb+srv://${process.env.DB_Name}:${process.env.DB_PASS}@app.759oy5v.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri);

const HF_TOKEN = process.env.HUGGING_TOKEN;
const Hclient = new InferenceClient(HF_TOKEN);

let questionCollection;

// Connect to MongoDB
async function connectDB() {
  try {
    await client.connect();
    const db = client.db("studySync");
    questionCollection = db.collection("questions");
    console.log("MongoDB connected!");
  } catch (err) {
    console.error("DB connection failed:", err);
  }
}
connectDB();

// ============================================
// MCQ Generator Route
// ============================================
app.post("/ask", async (req, res) => {
  console.log(req.body);
  try {
    const { question, correctAnswer } = req.body;
    if (!question || !correctAnswer) {
      return res.status(400).json({ error: "Question and correctAnswer are required" });
    }

    const prompt = `
You are an expert multiple-choice question generator.
Generate exactly 3 plausible but incorrect options (distractors) for the following question.
Output ONLY a JSON array of 3 strings.

Question: "${question}"
Correct Answer: "${correctAnswer}"
`;

    const out = await Hclient.chatCompletion({
      model: "meta-llama/Llama-3.1-8B-Instruct",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 256,
    });

    let distractors = out.choices[0].message.content;

    try {
      distractors = JSON.parse(distractors);
      if (!Array.isArray(distractors)) throw new Error("Not an array");
    } catch {
      distractors = distractors
        .split("\n")
        .map((x) => x.replace(/^- /, "").trim())
        .filter((x) => x && x !== correctAnswer)
        .slice(0, 3);
    }

    while (distractors.length < 3) distractors.push("Option " + (distractors.length + 1));

    const options = [correctAnswer, ...distractors].sort(() => Math.random() - 0.5);

    if (questionCollection) {
      const result = await questionCollection.insertOne({
        question,
        correctAnswer,
        options,
        timestamp: new Date(),
      });
      res.json(result.ops ? result.ops[0] : result);
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET all questions
app.get("/ask", async (req, res) => {
  try {
    const questions = await questionCollection.find({}).toArray();
    res.json(questions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single question by id
app.get("/ask/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const question = await questionCollection.findOne({ _id: new ObjectId(id) });
    if (!question) return res.status(404).json({ error: "Question not found" });
    res.json(question);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Patch update a question
app.patch("/ask/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const updateData = { ...req.body, updatedAt: new Date() };
    await questionCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );
    const updatedQuestion = await questionCollection.findOne({ _id: new ObjectId(id) });
    res.json(updatedQuestion);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// DELETE a question
app.delete("/ask/:id", async (req, res) => {
  try {
    const id = req.params.id;
    await questionCollection.deleteOne({ _id: new ObjectId(id) });
    res.json({ message: "Question deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Root route
app.get("/", (req, res) => {
  res.send("Server is running");
});

// Start Server
app.listen(port, () => {
  console.log(`🚀 Server listening on http://localhost:${port}`);
});
