import { Body, Controller, Get, Post } from '@nestjs/common';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { readFileSync } from 'fs';
import { join } from 'path';
import { TrackingService } from './tracking.service';
import { TrackRequestDto } from './dto/track-request.dto';
import { parseCsv } from './csv.util';
import { ShipmentInput, ShipmentType } from './models';

class CsvRequestDto {
  @IsString()
  csv!: string;

  @IsOptional()
  @IsBoolean()
  demo?: boolean;

  @IsOptional()
  @IsBoolean()
  short?: boolean;

  @IsOptional()
  @IsBoolean()
  debug?: boolean;
}

@Controller()
export class TrackingController {
  constructor(private readonly tracking: TrackingService) {}

  @Get('health')
  health() {
    return { status: 'ok', service: 'cargo-tracker', time: new Date().toISOString() };
  }

  @Post('track')
  async track(@Body() dto: TrackRequestDto) {
    const shipments: ShipmentInput[] = dto.shipments.map((s) => ({
      id: s.id ?? null,
      number: s.number,
      type: (s.type as ShipmentType) ?? null,
      carrier: s.carrier ?? null,
      comment: s.comment ?? null,
    }));
    return this.tracking.track(shipments, {
      demoMode: dto.demo,
      shortFormat: !!dto.short,
      debug: !!dto.debug,
    });
  }

  @Post('track/csv')
  async trackCsv(@Body() dto: CsvRequestDto) {
    const shipments = parseCsv(dto.csv);
    return this.tracking.track(shipments, {
      demoMode: dto.demo,
      shortFormat: !!dto.short,
      debug: !!dto.debug,
    });
  }

  @Get('schema')
  schema() {
    // Served from the bundled schema file so the contract is discoverable.
    const candidates = [
      join(process.cwd(), 'schema', 'response.schema.json'),
      join(process.cwd(), 'dist-server', 'schema', 'response.schema.json'),
      join(__dirname, '..', 'schema', 'response.schema.json'),
      join(__dirname, '..', '..', 'schema', 'response.schema.json'),
      join(__dirname, '..', '..', '..', 'schema', 'response.schema.json'),
    ];
    for (const p of candidates) {
      try {
        return JSON.parse(readFileSync(p, 'utf8'));
      } catch {
        /* try next */
      }
    }
    return {
      note: 'Schema file not bundled in this environment. See schema/response.schema.json in the repo, or /response.schema.json (static).',
    };
  }
}
