const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'F1 MyPitWall API Documentation',
      version: '1.0.0',
      description: 'API documentation for the F1 MyPitWall dashboard backend.',
    },
  },
  apis: ['./src/api/routes/*.js'], // Path to the API docs
};

const specs = swaggerJsdoc(options);

module.exports = specs;
