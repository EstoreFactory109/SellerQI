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
    followUps: {
      type: [String],
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
  },
  {
    timestamps: true,
  }
);

// List user's chats by most recently updated
QMateChatSchema.index({ User: 1, updatedAt: -1 });

module.exports = mongoose.model('QMateChat', QMateChatSchema);
