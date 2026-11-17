// Unit test Paket di Kalender Ketersediaan (brief 17 Nov 2026) --
// computeBundleAvailability(): sisa paket = min over komponen,
// floor(sisa komponen / jumlah per paket); status pakai ambang sama
// seperti alat satuan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBundleAvailability, computeBundleStatus } from '../bundleAvailability.js';
import type { Bundle, BundleComponentRow } from '../../hooks/useBundles.js';
import type { AvailabilityItem } from '../../hooks/useAvailability.js';

function component(overrides: Partial<BundleComponentRow>): BundleComponentRow {
  return { id: 'c1', item_id: 'item-1', quantity: 1, ...overrides };
}

function bundle(overrides: Partial<Bundle>): Bundle {
  return {
    id: 'b1',
    name: 'Paket Tektok',
    image_url: null,
    description: null,
    category: null,
    pricing_mode: 'ikuti_alat',
    price_per_day: null,
    day2_rate: null,
    day3_rate: null,
    day4_rate: null,
    day5_rate: null,
    extra_day_rate: null,
    discount_type: null,
    discount_value: null,
    deactivated_at: null,
    created_at: '2026-01-01T00:00:00Z',
    bundle_items: [component({})],
    ...overrides,
  };
}

function availItem(overrides: Partial<AvailabilityItem>): AvailabilityItem {
  return {
    id: 'item-1',
    code: null,
    name: 'Tenda Dome',
    category: null,
    image_url: null,
    total_units: 10,
    price_per_day: 20_000,
    remaining: [10, 10],
    status: ['tersedia', 'tersedia'],
    ...overrides,
  };
}

test('computeBundleStatus: ambang sama seperti alat satuan (20%, minimal 1)', () => {
  assert.equal(computeBundleStatus(0, 10), 'penuh');
  assert.equal(computeBundleStatus(2, 10), 'sisa_sedikit');
  assert.equal(computeBundleStatus(3, 10), 'tersedia');
  assert.equal(computeBundleStatus(1, 2), 'sisa_sedikit'); // floor(2*0.2)=0 -> dibulatkan ke minimal 1
});

test('computeBundleAvailability: dua komponen beda sisa, min yang menang + nama pembatas', () => {
  const b = bundle({
    bundle_items: [component({ item_id: 'item-1', quantity: 1 }), component({ id: 'c2', item_id: 'item-2', quantity: 2 })],
  });
  const items = [
    availItem({ id: 'item-1', name: 'Tenda Dome', total_units: 10, remaining: [10, 10] }),
    availItem({ id: 'item-2', name: 'Headlamp LED', total_units: 20, remaining: [6, 6] }), // floor(6/2)=3, lebih kecil dari 10
  ];
  const result = computeBundleAvailability(b, items);
  assert.equal(result.allComponentsActive, true);
  assert.equal(result.days[0].remaining, 3);
  assert.equal(result.days[0].limitingComponentName, 'Headlamp LED');
});

test('computeBundleAvailability: pembulatan floor saat sisa tidak habis dibagi', () => {
  const b = bundle({ bundle_items: [component({ item_id: 'item-1', quantity: 3 })] });
  const items = [availItem({ id: 'item-1', total_units: 9, remaining: [7, 7] })];
  const result = computeBundleAvailability(b, items);
  assert.equal(result.days[0].remaining, 2); // floor(7/3)=2
});

test('computeBundleAvailability: komponen nonaktif/hilang dari daftar alat -> paket tidak boleh tampil', () => {
  const b = bundle({ bundle_items: [component({ item_id: 'item-tidak-ada' })] });
  const result = computeBundleAvailability(b, [availItem({})]);
  assert.equal(result.allComponentsActive, false);
  assert.deepEqual(result.days, []);
});

test('computeBundleAvailability: komponen habis -> paket penuh', () => {
  const b = bundle({ bundle_items: [component({ item_id: 'item-1', quantity: 1 })] });
  const items = [availItem({ id: 'item-1', total_units: 10, remaining: [0, 0] })];
  const result = computeBundleAvailability(b, items);
  assert.equal(result.days[0].remaining, 0);
  assert.equal(result.days[0].status, 'penuh');
});
