import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  ValidateNested,
  ArrayMaxSize,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ShipmentInputDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  number!: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  carrier?: string;

  @IsOptional()
  @IsString()
  comment?: string;
}

export class TrackRequestDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ShipmentInputDto)
  shipments!: ShipmentInputDto[];

  /** Per-request override of DEMO_MODE. */
  @IsOptional()
  @IsBoolean()
  demo?: boolean;

  /** Also include the short integration format per result (ТЗ §8.1). */
  @IsOptional()
  @IsBoolean()
  short?: boolean;

  /** Include the per-shipment debug step log (ТЗ §12). */
  @IsOptional()
  @IsBoolean()
  debug?: boolean;
}
