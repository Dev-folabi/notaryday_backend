import { EmailTemplatesService } from './email-templates.service';
import { PrismaService } from '../../config/prisma.service';

describe('EmailTemplatesService.render', () => {
  let service: EmailTemplatesService;

  beforeEach(() => {
    service = new EmailTemplatesService({} as PrismaService);
  });

  it('replaces simple variables in subject and body', () => {
    const result = service.render(
      { subject: 'Hi {{name}}', body: '<p>Hello {{name}}</p>' },
      { name: 'Marcus' },
    );
    expect(result.subject).toBe('Hi Marcus');
    expect(result.body).toBe('<p>Hello Marcus</p>');
  });

  it('removes a section block when its variable is empty', () => {
    const result = service.render(
      {
        subject: 'Update',
        body: '<p>Intro</p>{{#alt}}<ul>{{alt}}</ul>{{/alt}}<p>Outro</p>',
      },
      { alt: '' },
    );
    expect(result.body).toBe('<p>Intro</p><p>Outro</p>');
  });

  it('keeps a section block and renders its variable when present', () => {
    const result = service.render(
      {
        subject: 'Update',
        body: '<p>Intro</p>{{#alt}}<ul>{{alt}}</ul>{{/alt}}<p>Outro</p>',
      },
      { alt: '<li>Friday at 10:00 AM (PDT)</li>' },
    );
    expect(result.body).toBe(
      '<p>Intro</p><ul><li>Friday at 10:00 AM (PDT)</li></ul><p>Outro</p>',
    );
  });

  it('handles multiple variables with section blocks', () => {
    const result = service.render(
      {
        subject: 'Regarding your booking with {{notary_name}}',
        body: '<p>Hi {{client_name}},</p>{{#alternative_times}}<ul>{{alternative_times}}</ul>{{/alternative_times}}',
      },
      {
        client_name: 'Jessica',
        notary_name: 'Tomm',
        alternative_times: '',
      },
    );
    expect(result.subject).toBe('Regarding your booking with Tomm');
    expect(result.body).toBe('<p>Hi Jessica,</p>');
  });

  it('converts a plain-text body into paragraphs', () => {
    const result = service.render(
      {
        subject: 'Reminder',
        body: 'Hi {{name}},\n\nSee you at {{time}}.',
      },
      { name: 'Marcus', time: '2:00 PM' },
    );
    expect(result.body).toBe('<p>Hi Marcus,</p><p>See you at 2:00 PM.</p>');
  });

  it('joins single newlines with line breaks', () => {
    const result = service.render(
      { subject: 'Invoice', body: 'Amount: {{total}}\nDue on receipt.' },
      { total: '145.00' },
    );
    expect(result.body).toBe('<p>Amount: 145.00<br>Due on receipt.</p>');
  });

  it('escapes user text but preserves variables', () => {
    const result = service.render(
      { subject: 'X', body: 'Tom & Jerry < next {{name}}' },
      { name: 'Marcus' },
    );
    expect(result.body).toBe('<p>Tom &amp; Jerry &lt; next Marcus</p>');
  });

  it('drops a text section block when its variable is empty', () => {
    const result = service.render(
      {
        subject: 'Update',
        body: 'Hi {{client_name}},\n\n{{#alternative_times}}\nHere are some alternative times:\n\n{{alternative_times}}\n{{/alternative_times}}\n\nBye.',
      },
      { client_name: 'Lena', alternative_times: '' },
    );
    expect(result.body).toBe('<p>Hi Lena,</p><p>Bye.</p>');
  });

  it('renders a text section block as a list when its variable is present', () => {
    const result = service.render(
      {
        subject: 'Update',
        body: 'Hi {{client_name}},\n\n{{#alternative_times}}\nHere are some alternative times:\n\n{{alternative_times}}\n{{/alternative_times}}\n\nBye.',
      },
      {
        client_name: 'Lena',
        alternative_times: '<li>Fri at 10:00 AM</li><li>Sat at 2:00 PM</li>',
      },
    );
    expect(result.body).toBe(
      '<p>Hi Lena,</p><p>Here are some alternative times:</p><ul><li>Fri at 10:00 AM</li><li>Sat at 2:00 PM</li></ul><p>Bye.</p>',
    );
  });
});
