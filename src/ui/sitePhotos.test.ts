import { describe, expect, it } from 'vitest';
import type { MapItem } from '../map';
import { cameraName, photoSiteNear, photosByPoi, type SitePhoto } from './sitePhotos';

const photo = (poi: string, file: string): SitePhoto => ({ poi, file, sol: 4, instrument: 'MCZ_LEFT', date_taken_utc: '2021-03-01T08:08:09', credit: 'NASA/JPL-Caltech/ASU' });
const item = (id: string, x: number, y: number, poiId?: string): MapItem => ({ id, kind: 'clue', label: id, at: { x, y }, hidden: false, ...(poiId ? { poiId } : {}) });

describe('then-and-now site photos', () => {
  const photos = photosByPoi(
    [{ id: 'landing_site', photos: ['a.jpg', 'b.jpg'] }, { id: 'heat_shield', photos: ['c.jpg'] }, { id: 'sample_03', photos: [] }],
    [photo('landing', 'a.jpg'), photo('landing', 'b.jpg'), photo('heatshield', 'c.jpg')],
  );

  it('keeps the first photo of each site, matched by file name', () => {
    expect(photos.get('landing_site')?.file).toBe('a.jpg');
    expect(photos.get('heat_shield')?.sol).toBe(4);
    expect(photos.size).toBe(2);
  });

  it('finds the nearest photographed site within reach, and nothing beyond it', () => {
    const items = [item('landing_site', 0, 0, 'landing_site'), item('heat_shield', 10, 0, 'heat_shield'), item('scrap', 1, 1)];
    expect(photoSiteNear(items, { x: 8, y: 0 }, photos)?.item.id).toBe('heat_shield');
    expect(photoSiteNear(items, { x: 1, y: 0 }, photos)?.photo.file).toBe('a.jpg');
    expect(photoSiteNear(items, { x: 200, y: 0 }, photos)).toBeNull();
  });

  it('names the camera', () => {
    expect(cameraName('MCZ_LEFT')).toBe('Mastcam-Z (left)');
    expect(cameraName('SOME_CAM')).toBe('some cam');
    expect(cameraName('MRO HiRISE (ESP_1)')).toBe('MRO HiRISE (ESP_1)');
  });
});
