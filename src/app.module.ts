import { Module } from '@nestjs/common';
import { AccountModule } from './account/account.module.js';
import { AdminModule } from './admin/admin.module.js';
import { AppController } from './app.controller.js';
import { AuthModule } from './auth/auth.module.js';
import { ConstructorModule } from './constructors/constructor.module.js';
import { DatabaseModule } from './database/database.module.js';
import { DriverModule } from './drivers/driver.module.js';
import { LiveModule } from './live/live.module.js';
import { ProfileModule } from './profile/profile.module.js';
import { RaceModule } from './races/race.module.js';
import { ResultModule } from './results/result.module.js';
import { SecurityModule } from './security/security.module.js';
import { TriviaModule } from './trivia/trivia.module.js';

@Module({
  imports: [
    SecurityModule,
    DatabaseModule,
    ConstructorModule,
    DriverModule,
    ResultModule,
    RaceModule,
    TriviaModule,
    AuthModule,
    AdminModule,
    ProfileModule,
    LiveModule,
    AccountModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
