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
    subjectCollection = db.collection("subjects");
    lessonCollection = db.collection("lessons");
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
  try {
    const data = req.body;
    const { mcq } = data;

    // If there are MCQs, process them first
    if (mcq && mcq.length > 0) {
      for (let i = 0; i < mcq.length; i++) {
        const { question, correctAnswer } = mcq[i];

        if (!question || !correctAnswer) {
          return res
            .status(400)
            .json({ error: "Each MCQ must have a question and correctAnswer" });
        }

        // Prompt for AI
        const prompt = `
You are an expert multiple-choice question generator.
Generate exactly 3 plausible but incorrect options (distractors) for the following question.
Output ONLY a JSON array of 3 strings.

Question: "${question}"
Correct Answer: "${correctAnswer}"
`;

        // Call Hugging Face
        const out = await Hclient.chatCompletion({
          model: "meta-llama/Llama-3.1-8B-Instruct",

          messages: [{ role: "user", content: prompt }],
          max_tokens: 256,
        });

        let distractors = out.choices[0].message.content;

        // Parse AI output
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

        // Ensure always 3 distractors
        while (distractors.length < 3) {
          distractors.push("Option " + (distractors.length + 1));
        }

        // Combine and shuffle
        const options = [correctAnswer, ...distractors].sort(
          () => Math.random() - 0.5
        );

        // Replace mcq item with generated options
        mcq[i].options = options;
      }
    }

    // Insert the full lesson object
    const result = await questionCollection.insertOne({
      ...data,
      createdAt: new Date(),
    });

    res.status(201).json({
      message: "Lesson inserted successfully",
      insertedId: result.insertedId,
    });
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
    const question = await questionCollection.findOne({
      _id: new ObjectId(id),
    });
    if (!question) return res.status(404).json({ error: "Question not found" });
    res.json(question);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/lesson/:subject", async (req, res) => {
  try {
    const subject = req.params.subject;
    const query = subject.toLowerCase();
    const lessons = await questionCollection
      .find({
        query: query,
      })
      .toArray();
    if (!question) return res.status(404).json({ error: "subject not found" });
    res.json(lessons);
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
      { $set: updateData },
      { upsert: ture }
    );
    const updatedQuestion = await questionCollection.findOne({
      _id: new ObjectId(id),
    });
    res.json(updatedQuestion);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE a lesson -> শুধু question fields clear হবে
app.delete("/lesson/:id", async (req, res) => {
  try {
    const id = req.params.id;

    const updateFields = {
      lesson: null,
      fillBlanks: [],
      shortQuestion: [],
      mcq: [],
      trueFalse: [],
    };

    await questionCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateFields }
    );

    const updated = await questionCollection.findOne({ _id: new ObjectId(id) });
    res.json({
      message: "Lesson cleared successfully",
      data: updated,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE subject -> subject এর সব lesson delete হবে

app.delete("/subject/:id", async (req, res) => {
  try {
    const id = req.params.id;

    const result = await questionCollection.deleteOne({
      _id: new ObjectId(id),
    });

    res.send(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================

// subject topic post

app.post("/subject", async (req, res) => {
  const { subject } = req.body;
  try {
    const match = await subjectCollection.findOne({ subject });
    if (match) {
      return res.status(400).send({ message: "subject already exists" });
    } else {
      const result = await subjectCollection.insertOne({ subject });
      res.send(result);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});








app.post("/lessons", async (req, res) => {
  const { subjectId, lesson } = req.body;



  try {
    const match = await lessonCollection.findOne({ subjectId, lesson });
    if (match) {
      return res.status(400).send({ message: "lesson already exists" });
    } else {
      const result = await lessonCollection.insertOne({ subjectId, lesson });
      res.send(result);
    }
  } catch (err) {
    console.log(err);
  }
});









// Root root
app.get("/", (req, res) => {
  res.send("Server is running");
});

// Start Server
app.listen(port, () => {
  console.log(`🚀 Server listening on http://localhost:${port}`);
});
