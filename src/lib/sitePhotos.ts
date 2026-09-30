// Photos used on the landing page, keyed by the section they belong to. The files
// live in public/photos; src/data/sitePhotos.json records where each one came from.
export interface SitePhoto {
  src: string;
  /** CSS object-position, chosen so the person stays in frame when the photo is cropped. */
  position: string;
}

/** One photo per template group on the landing page. */
export const TEMPLATE_GROUP_PHOTOS: Record<string, SitePhoto> = {
  reception: { src: '/photos/templates-reception.jpg', position: '50% 10%' },
  support: { src: '/photos/templates-support.jpg', position: '50% 25%' },
  outbound: { src: '/photos/templates-outbound.jpg', position: '50% 22%' },
  verification: { src: '/photos/templates-menus.jpg', position: '50% 15%' },
};

export const DEMO_CALLER_PHOTO = '/photos/demo-caller.jpg';
