/* Shared error helpers. */
'use strict';

class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// multer error marker — imported where needed to avoid a circular require.
const multerError = require('multer').MulterError;

module.exports = { AppError, multerError };
