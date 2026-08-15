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
});
