// Display order of the Review views; the first one is the default (also used in #review/<view> URLs).
export const REVIEW_VIEWS = { meetings: 'Meetings', tasks: 'Tasks', links: 'Links', self: 'Self-Review' } as const
export type ReviewMode = keyof typeof REVIEW_VIEWS
export const isReviewMode = (v: string | undefined): v is ReviewMode => !!v && v in REVIEW_VIEWS
