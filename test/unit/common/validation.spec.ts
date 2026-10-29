import { ArgumentMetadata } from '@nestjs/common';
import { IsBoolean, IsString, MaxLength } from 'class-validator';
import { ApiExposeProperty, ToBoolean, Trim } from '@/common/decorators';
import { AppError, ErrorCode } from '@/common/errors';
import { createValidationPipe } from '@/common/validation';

class AddressDto {
  @ApiExposeProperty()
  @IsString()
  city: string;
}

class CreateCustomerDto {
  @ApiExposeProperty()
  @Trim()
  @IsString()
  @MaxLength(5)
  name: string;

  @ApiExposeProperty({ type: AddressDto })
  address: AddressDto;

  @ApiExposeProperty({ type: () => AddressDto, isArray: true, nullable: true })
  previousAddresses?: AddressDto[];

  @ApiExposeProperty({ type: String, nullable: true })
  @IsString()
  note?: string;

  @ApiExposeProperty({ nullable: true })
  @ToBoolean()
  @IsBoolean()
  active?: boolean;
}

describe('createValidationPipe', () => {
  const pipe = createValidationPipe();
  const metadata: ArgumentMetadata = {
    type: 'body',
    metatype: CreateCustomerDto,
  };

  it('transforms a valid payload into the DTO, including nested classes', async () => {
    const result = (await pipe.transform(
      {
        name: '  Linh ',
        address: { city: 'Hanoi' },
        previousAddresses: [{ city: 'Hue' }],
        note: 'VIP',
        active: 'true',
      },
      metadata,
    )) as CreateCustomerDto;

    expect(result).toBeInstanceOf(CreateCustomerDto);
    expect(result.name).toBe('Linh');
    expect(result.address).toBeInstanceOf(AddressDto);
    expect(result.previousAddresses?.[0]).toBeInstanceOf(AddressDto);
    expect(result.active).toBe(true);
  });

  it('rejects unknown and invalid fields with one entry per field path', async () => {
    const error = await pipe
      .transform(
        {
          name: 'too long',
          address: { city: 42 },
          previousAddresses: [{ city: null }],
          active: 'yes',
          extra: true,
        },
        metadata,
      )
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(ErrorCode.VALIDATION_FAILED);
    const fields = (
      (error as AppError).extensions.errors as { field: string }[]
    ).map((e) => e.field);
    expect(fields.sort()).toEqual([
      'active',
      'address.city',
      'extra',
      'name',
      'previousAddresses.0.city',
    ]);
  });
});
