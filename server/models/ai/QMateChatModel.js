const mongoose = require('mongoose');

const QMateMessageSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      enum: ['user', 'assistant'],
      required: true,
    },
    content: {
      type: String,
      required: true,
      default: '',
    },
    charts: {
      type: mongoose.Schema.Types.Mixed,
      default: [],
    },
    // Follow-ups may be legacy strings OR structured { label, prompt } objects
    // (Phase 4 deterministic follow-ups / FinanceEngine). Use an array of Mixed
    // so both shapes persist — a [String] type throws a CastError on objects.
    followUps: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
  },
  { _id: true }
);

const QMateChatSchema = new mongoose.Schema(
  {
    User: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      default: 'New Chat',
      trim: true,
      maxlength: 100,
    },
    messages: {
      type: [QMateMessageSchema],
      default: [],
    },
    // Phase 5 / Task 5.1: structured conversation state carried across turns.
    // Not raw chat messages — a compact summary of active entities, time range,
    // last intent/engine, and task context used to resolve implicit references.
    conversationContext: {
      type: {
        activeAsins: { type: [String], default: [] },
        activeMetrics: { type: [String], default: [] },
        activeTimeRange: {
          type: { type: String },
          value: String,
          startDate: String,
          endDate: String,
        },
        lastIntent: String,
        lastEngine: String,
        lastDataSources: { type: [String], default: [] },
        taskContext: String, // e.g., 'ppc_optimization', 'listing_fix', 'general'
        turnCount: { type: Number, default: 0 },
      },
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

// List user's chats by most recently updated
QMateChatSchema.index({ User: 1, updatedAt: -1 });

module.exports = mongoose.model('QMateChat', QMateChatSchema);
