import type { Model } from 'mongoose';
import type { Models } from '../models.ts';
import { nextId } from '../models.ts';
import { faqs, plans, sections, services, team, testimonials } from './demoData.ts';

/** Port of legacy updateOrCreate: match on the natural key, then set the rest. Re-running restores the sample copy. */
async function upsert(m: Models, model: Model<never>, key: Record<string, unknown>, values: Record<string, unknown>): Promise<void> {
  const found = await model.findOne(key as never, { _id: 1 }).lean<{ _id: number }>();
  if (found) await model.updateOne({ _id: found._id } as never, { $set: values } as never);
  else await model.create({ ...key, ...values, _id: await nextId(m, model.collection.name) } as never);
}

const day = { open: '09:00', close: '18:00', closed: false };
const half = { open: '10:00', close: '14:00', closed: false };
const off = { open: null, close: null, closed: true };

/** Sample business content (legacy Site*Seeder classes: settings, sections, services, pricing, testimonials, team, FAQs). */
export async function seedDemo(m: Models): Promise<void> {
  await m.Setting.updateOne({ _id: 1 }, {
    $set: {
      site_name: 'Northwind Consulting', site_name_2nd: 'নর্থউইন্ড কনসালটিং',
      tagline: 'Practical advice that helps small businesses grow', tagline_2nd: 'ব্যবহারিক পরামর্শ যা ছোট ব্যবসাকে এগিয়ে নিতে সাহায্য করে',
      address: '12 Market Street\nSpringfield, 12345', address_2nd: '১২ মার্কেট স্ট্রিট\nস্প্রিংফিল্ড, ১২৩৪৫',
      phone: '+1 555 010 2030', email: 'hello@northwind.example',
      hours: { mon: day, tue: day, wed: day, thu: day, fri: day, sat: half, sun: off },
      social_links: {
        facebook: 'https://facebook.com/northwind.example', instagram: 'https://instagram.com/northwind.example',
        linkedin: 'https://linkedin.com/company/northwind-example',
      },
    },
  }, { upsert: true });

  let order = 0;
  for (const [key, title, title2, content, content2] of sections) {
    order += 10;
    await upsert(m, m.Section as never, { key }, { title, title_2nd: title2, content, content_2nd: content2, sort_order: order, is_visible: key !== 'pricing' });
  }

  const ordered = (i: number) => ({ sort_order: (i + 1) * 10, is_visible: true });
  for (const [i, [question, question2, answer, answer2]] of faqs.entries()) {
    await upsert(m, m.Faq as never, { question }, { question_2nd: question2, answer, answer_2nd: answer2, ...ordered(i) });
  }
  for (const [i, [title, title2, description, description2]] of services.entries()) {
    await upsert(m, m.Service as never, { title }, { title_2nd: title2, description, description_2nd: description2, ...ordered(i) });
  }
  const allServices = await m.Service.find({}).sort({ sort_order: 1, _id: 1 }).lean();
  for (const [i, service] of allServices.entries()) {
    const base = 250 + (i % 3) * 100;
    for (const [j, [name, name2, multiplier, description, description2, features, features2, featured]] of plans.entries()) {
      await upsert(m, m.Pricing as never, { service_id: service._id, name }, {
        name_2nd: name2, price: base * (multiplier as number), unit: 'per project', unit_2nd: 'প্রতি প্রকল্প',
        description, description_2nd: description2, features, features_2nd: features2, is_featured: featured, ...ordered(j),
      });
    }
  }
  for (const [i, [author, role, role2, quote, quote2]] of testimonials.entries()) {
    await upsert(m, m.Testimonial as never, { author_name: author }, { author_role: role, author_role_2nd: role2, quote, quote_2nd: quote2, ...ordered(i) });
  }
  for (const [i, [name, role, role2, bio, bio2]] of team.entries()) {
    await upsert(m, m.TeamMember as never, { name }, { role, role_2nd: role2, bio, bio_2nd: bio2, ...ordered(i) });
  }
}
