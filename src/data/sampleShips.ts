import type { Ship } from '@/types/model';

/**
 * OPTIONAL starter set — never loaded automatically.
 *
 * The ship database is meant to be supplied by the user (Ships -> Import
 * Data). This handful of Tier X ships exists only so the editor is usable the
 * moment it opens, and the values are approximations rounded for planning
 * geometry, not an authoritative stat sheet. The Ship Database panel labels
 * them as sample data and every field is editable.
 */
export const SAMPLE_SHIPS: Omit<Ship, 'id'>[] = [
  {
    name: 'Des Moines', nation: 'USA', class: 'CA', tier: 10, hp: 60000, speed_kn: 33,
    concealment_km: 9.6, mainBatteryRange_km: 15.8, mainBattery: '3 x 3 203 mm/55',
    secondaryRange_km: 5.0, aaRange_km: 6.0, radar_km: 10.0, radarDuration_s: 40,
    hydro_km: 5.0, hydroDuration_s: 100, rudderShift_s: 9.4, turningCircle_m: 760,
    consumables: [{ name: 'Damage Control' }, { name: 'Repair Party' }, { name: 'Defensive AA Fire' }],
  },
  {
    name: 'Worcester', nation: 'USA', class: 'CA', tier: 10, hp: 42900, speed_kn: 33,
    concealment_km: 9.6, mainBatteryRange_km: 15.7, mainBattery: '6 x 2 152 mm/47',
    secondaryRange_km: 5.0, aaRange_km: 6.9, radar_km: 8.5, radarDuration_s: 35,
    hydro_km: 5.0, rudderShift_s: 8.6, turningCircle_m: 730,
    consumables: [{ name: 'Damage Control' }, { name: 'Repair Party' }, { name: 'Defensive AA Fire' }],
  },
  {
    name: 'Montana', nation: 'USA', class: 'BB', tier: 10, hp: 96300, speed_kn: 30,
    concealment_km: 16.4, mainBatteryRange_km: 20.4, mainBattery: '4 x 3 406 mm/50',
    secondaryRange_km: 7.0, aaRange_km: 5.8, rudderShift_s: 19.6, turningCircle_m: 920,
    consumables: [{ name: 'Damage Control' }, { name: 'Repair Party' }],
  },
  {
    name: 'Gearing', nation: 'USA', class: 'DD', tier: 10, hp: 21100, speed_kn: 36.5,
    concealment_km: 5.9, mainBatteryRange_km: 11.1, mainBattery: '3 x 2 127 mm/38',
    torpedoRange_km: 10.5, torpedoSpeed_kn: 66, torpedoArc_deg: 40, torpedoes: '2 x 5 533 mm',
    aaRange_km: 5.0, hydro_km: 5.0, smokeDuration_s: 81, smokeRadius_km: 0.45,
    rudderShift_s: 4.0, turningCircle_m: 640,
    consumables: [{ name: 'Damage Control' }, { name: 'Smoke Generator' }, { name: 'Engine Boost' }],
  },
  {
    name: 'Yamato', nation: 'Japan', class: 'BB', tier: 10, hp: 97200, speed_kn: 27,
    concealment_km: 16.3, mainBatteryRange_km: 26.6, mainBattery: '3 x 3 460 mm/45',
    secondaryRange_km: 7.4, aaRange_km: 5.8, rudderShift_s: 19.0, turningCircle_m: 1000,
    consumables: [{ name: 'Damage Control' }, { name: 'Repair Party' }],
  },
  {
    name: 'Zao', nation: 'Japan', class: 'CA', tier: 10, hp: 41400, speed_kn: 34.5,
    concealment_km: 9.1, mainBatteryRange_km: 17.5, mainBattery: '4 x 2 203 mm/50',
    torpedoRange_km: 12.0, torpedoSpeed_kn: 62, torpedoArc_deg: 55, torpedoes: '2 x 5 610 mm',
    secondaryRange_km: 4.5, aaRange_km: 5.2, rudderShift_s: 10.6, turningCircle_m: 780,
    consumables: [{ name: 'Damage Control' }, { name: 'Repair Party' }, { name: 'Hydroacoustic Search' }],
    hydro_km: 5.0,
  },
  {
    name: 'Shimakaze', nation: 'Japan', class: 'DD', tier: 10, hp: 21500, speed_kn: 39,
    concealment_km: 5.6, mainBatteryRange_km: 11.5, mainBattery: '3 x 1 127 mm/50',
    torpedoRange_km: 20.0, torpedoSpeed_kn: 67, torpedoArc_deg: 45, torpedoes: '3 x 5 610 mm',
    aaRange_km: 4.6, smokeDuration_s: 30, smokeRadius_km: 0.45,
    rudderShift_s: 4.4, turningCircle_m: 700,
    consumables: [{ name: 'Damage Control' }, { name: 'Smoke Generator' }, { name: 'Engine Boost' }],
  },
  {
    name: 'Hakuryu', nation: 'Japan', class: 'CV', tier: 10, hp: 63000, speed_kn: 32,
    concealment_km: 15.1, mainBatteryRange_km: 10.8, aaRange_km: 5.8,
    rudderShift_s: 17.7, turningCircle_m: 1230,
    consumables: [{ name: 'Damage Control' }, { name: 'Repair Party' }, { name: 'Squadron Fighters' }],
    fighter: true,
  },
  {
    name: 'Kremlin', nation: 'USSR', class: 'BB', tier: 10, hp: 98300, speed_kn: 32,
    concealment_km: 16.4, mainBatteryRange_km: 20.7, mainBattery: '4 x 3 457 mm/55',
    secondaryRange_km: 7.5, aaRange_km: 6.6, hydro_km: 5.0, hydroDuration_s: 180,
    rudderShift_s: 18.8, turningCircle_m: 950,
    consumables: [{ name: 'Damage Control' }, { name: 'Repair Party' }, { name: 'Hydroacoustic Search' }],
  },
  {
    name: 'Petropavlovsk', nation: 'USSR', class: 'CA', tier: 10, hp: 65900, speed_kn: 33,
    concealment_km: 15.2, mainBatteryRange_km: 19.4, mainBattery: '3 x 3 220 mm/65',
    radar_km: 12.0, radarDuration_s: 25, aaRange_km: 6.0,
    rudderShift_s: 12.6, turningCircle_m: 940,
    consumables: [{ name: 'Damage Control' }, { name: 'Repair Party' }, { name: 'Surveillance Radar' }],
  },
  {
    name: 'Stalingrad', nation: 'USSR', class: 'CA', tier: 10, hp: 71400, speed_kn: 33.5,
    concealment_km: 15.6, mainBatteryRange_km: 20.6, mainBattery: '3 x 3 305 mm/61',
    radar_km: 12.0, radarDuration_s: 25, aaRange_km: 6.0, secondaryRange_km: 6.0,
    rudderShift_s: 13.6, turningCircle_m: 1010,
    consumables: [{ name: 'Damage Control' }, { name: 'Repair Party' }, { name: 'Surveillance Radar' }],
  },
  {
    name: 'Grozovoi', nation: 'USSR', class: 'DD', tier: 10, hp: 21700, speed_kn: 41,
    concealment_km: 7.2, mainBatteryRange_km: 12.9, mainBattery: '3 x 2 130 mm/58',
    torpedoRange_km: 8.0, torpedoSpeed_kn: 60, torpedoArc_deg: 45,
    aaRange_km: 5.8, smokeDuration_s: 20, smokeRadius_km: 0.6,
    rudderShift_s: 5.5, turningCircle_m: 700,
    consumables: [{ name: 'Damage Control' }, { name: 'Smoke Generator' }, { name: 'Engine Boost' }],
  },
  {
    name: 'Hindenburg', nation: 'Germany', class: 'CA', tier: 10, hp: 59900, speed_kn: 32.5,
    concealment_km: 11.9, mainBatteryRange_km: 19.1, mainBattery: '4 x 3 203 mm/60',
    torpedoRange_km: 6.0, torpedoSpeed_kn: 65, torpedoArc_deg: 50,
    secondaryRange_km: 7.4, aaRange_km: 5.8, hydro_km: 5.88, hydroDuration_s: 180,
    rudderShift_s: 12.1, turningCircle_m: 900,
    consumables: [{ name: 'Damage Control' }, { name: 'Repair Party' }, { name: 'Hydroacoustic Search' }],
  },
  {
    name: 'Grosser Kurfurst', nation: 'Germany', class: 'BB', tier: 10, hp: 105800, speed_kn: 30,
    concealment_km: 17.1, mainBatteryRange_km: 21.2, mainBattery: '4 x 3 406 mm/52',
    secondaryRange_km: 7.6, aaRange_km: 5.2, hydro_km: 5.88, hydroDuration_s: 180,
    rudderShift_s: 20.2, turningCircle_m: 1050,
    consumables: [{ name: 'Damage Control' }, { name: 'Repair Party' }, { name: 'Hydroacoustic Search' }],
  },
  {
    name: 'Minotaur', nation: 'UK', class: 'CA', tier: 10, hp: 32800, speed_kn: 33.9,
    concealment_km: 9.1, mainBatteryRange_km: 16.5, mainBattery: '5 x 2 152 mm/50',
    torpedoRange_km: 8.0, torpedoSpeed_kn: 62, torpedoArc_deg: 50,
    aaRange_km: 6.6, radar_km: 8.5, radarDuration_s: 40, smokeDuration_s: 20, smokeRadius_km: 0.45,
    rudderShift_s: 8.4, turningCircle_m: 730,
    consumables: [{ name: 'Damage Control' }, { name: 'Smoke Generator' }, { name: 'Surveillance Radar' }, { name: 'Defensive AA Fire' }],
  },
  {
    name: 'Daring', nation: 'UK', class: 'DD', tier: 10, hp: 22500, speed_kn: 35,
    concealment_km: 5.9, mainBatteryRange_km: 11.9, mainBattery: '3 x 2 113 mm/45',
    torpedoRange_km: 10.0, torpedoSpeed_kn: 62, torpedoArc_deg: 40,
    aaRange_km: 5.8, hydro_km: 3.0, smokeDuration_s: 15, smokeRadius_km: 0.45,
    rudderShift_s: 4.2, turningCircle_m: 620,
    consumables: [{ name: 'Damage Control' }, { name: 'Smoke Generator' }, { name: 'Hydroacoustic Search' }, { name: 'Repair Party' }],
  },
  {
    name: 'Venezia', nation: 'Italy', class: 'CA', tier: 10, hp: 47000, speed_kn: 34,
    concealment_km: 11.3, mainBatteryRange_km: 17.3, mainBattery: '4 x 3 203 mm/55',
    torpedoRange_km: 8.0, torpedoSpeed_kn: 60, torpedoArc_deg: 45,
    aaRange_km: 5.8, smokeDuration_s: 30, smokeRadius_km: 0.35,
    rudderShift_s: 11.7, turningCircle_m: 840,
    consumables: [{ name: 'Damage Control' }, { name: 'Repair Party' }, { name: 'Exhaust Smoke Generator' }],
  },
  {
    name: 'Midway', nation: 'USA', class: 'CV', tier: 10, hp: 33500, speed_kn: 33,
    concealment_km: 14.6, mainBatteryRange_km: 11.1, aaRange_km: 5.8,
    rudderShift_s: 18.0, turningCircle_m: 1230,
    consumables: [{ name: 'Damage Control' }, { name: 'Repair Party' }, { name: 'Squadron Fighters' }],
    fighter: true,
  },
];
