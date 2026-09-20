export const ADDRESS_VALIDATION_API = "https://wateroncall-backend-production-cov9zr.laravel.cloud/api/v1/addresses/validate";

export interface AddressInput {
  address_line1?: unknown;
  address_line2?: unknown;
  city?: unknown;
  province?: unknown;
  postal_code?: unknown;
  country_code?: unknown;
  formatted_address?: unknown;
  latitude?: unknown;
  longitude?: unknown;
}

export interface ValidatedAddress {
  address_line1: string;
  address_line2: string | null;
  city: string;
  province: string;
  postal_code: string;
  country_code: string;
  formatted_address: string;
  latitude: number | null;
  longitude: number | null;
  geocoding_provider: string | null;
  geocoding_place_id: string | null;
  validation_status: string;
  validation_granularity: string | null;
  address_validation_id: string | null;
  validated_at: string | null;
  action: "accept" | "confirm" | "add_subpremise" | "fix";
  message: string;
  token?: string;
}

export class AddressValidationError extends Error {
  status: number;
  address: ValidatedAddress | null;

  constructor(message: string, status = 422, address: ValidatedAddress | null = null) {
    super(message);
    this.name = "AddressValidationError";
    this.status = status;
    this.address = address;
  }
}

function clean(value: unknown): string | null {
  const result = String(value ?? "").trim();
  return result || null;
}

function numberOrNull(value: unknown): number | null {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

export function addressInput(input: AddressInput): Record<string, string | number | null> {
  return {
    address_line1: clean(input.address_line1),
    address_line2: clean(input.address_line2),
    city: clean(input.city),
    province: clean(input.province) || "Ontario",
    postal_code: clean(input.postal_code),
    country_code: clean(input.country_code) || "CA",
    formatted_address: clean(input.formatted_address),
    latitude: numberOrNull(input.latitude),
    longitude: numberOrNull(input.longitude),
  };
}

export async function validateAddress(input: AddressInput): Promise<ValidatedAddress> {
  let response: Response;
  try {
    response = await fetch(ADDRESS_VALIDATION_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(addressInput(input)),
    });
  } catch {
    throw new AddressValidationError("Address validation is temporarily unavailable. Please try again.", 503);
  }

  let payload: any = {};
  try { payload = await response.json(); } catch {}
  const address = payload?.data || null;
  if (!response.ok || !address || address.action === "fix") {
    const message = address?.message || payload?.errors?.address_line1?.[0] || payload?.message || "Google could not validate this address.";
    throw new AddressValidationError(message, response.ok ? 422 : response.status, address);
  }

  return address as ValidatedAddress;
}

export function needsConfirmation(address: ValidatedAddress): boolean {
  return address.action === "confirm" || address.action === "add_subpremise";
}

export function canonicalAddressFields(address: ValidatedAddress): Record<string, unknown> {
  return {
    address_line1: address.address_line1,
    address_line2: address.address_line2,
    city: address.city,
    province: address.province,
    postal_code: address.postal_code,
    country_code: address.country_code,
    formatted_address: address.formatted_address,
    latitude: address.latitude,
    longitude: address.longitude,
    google_place_id: address.geocoding_place_id,
    google_formatted_address: address.formatted_address,
    google_lat: address.latitude,
    google_lng: address.longitude,
    address_validation_token: address.token || null,
  };
}
