import type { Api } from '../../http/route.ts';

/** Counts each module the user may view, plus unread contact messages (legacy DashboardController). */
export function dashboardRoutes(api: Api): void {
  api.get('/dashboard', { permission: 'dashboard.view' }, async (_req, res) => {
    const m = res.locals.models();
    const auth = res.locals.auth!;
    const counted = { posts: m.Post, categories: m.Category, services: m.Service, testimonials: m.Testimonial, team: m.TeamMember, gallery: m.GalleryItem, faqs: m.Faq };
    const counts: Record<string, number> = {};
    for (const [key, model] of Object.entries(counted)) {
      if (auth.can(`${key}.view`)) counts[key] = await (model as { countDocuments(): Promise<number> }).countDocuments();
    }
    if (auth.can('contact.view')) counts.unread_messages = await m.ContactMessage.countDocuments({ read_at: null });
    res.json({ data: counts });
  });
}
