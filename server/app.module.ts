import { Module } from '@nestjs/common';
import { TrackingModule } from './tracking/tracking.module';

@Module({
  imports: [TrackingModule],
})
export class AppModule {}
