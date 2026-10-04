require('reflect-metadata');
const { Test } = require('@nestjs/testing');
const { AppModule } = require('../dist/app.module.js');
const { DatabaseService } = require('../dist/database/database.service.js');
const { configureApp } = require('../dist/app.setup.js');

const services = {
  accountService: require('../dist/account/account.service.js').AccountService,
  adminService: require('../dist/admin/admin.service.js').AdminService,
  authService: require('../dist/auth/auth.service.js').AuthService,
  constructorService: require('../dist/constructors/constructor.service.js').ConstructorService,
  driverService: require('../dist/drivers/driver.service.js').DriverService,
  liveTimingService: require('../dist/live/live-timing.service.js').LiveTimingService,
  profileService: require('../dist/profile/profile.service.js').ProfileService,
  raceService: require('../dist/races/race.service.js').RaceService,
  resultService: require('../dist/results/result.service.js').ResultService,
  triviaService: require('../dist/trivia/trivia.service.js').TriviaService,
};

async function createApp(db, overrides = {}) {
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DatabaseService)
    .useValue(db);
  for (const [service, value] of Object.entries(overrides)) {
    builder = builder.overrideProvider(services[service]).useValue(value);
  }
  const module = await builder.compile();
  const app = module.createNestApplication({ logger: false, bodyParser: false });
  const document = configureApp(app, false);
  await app.init();
  return { app, document };
}
module.exports = { createApp, services };
