import { ConfigService } from '@nestjs/config';
import { EmailRendererService } from './email-renderer.service';

describe('EmailRendererService', () => {
  const config = {
    get: jest.fn((key: string) =>
      key === 'EMAIL_ASSET_BASE_URL'
        ? 'https://assets.example.com/branding/'
        : '',
    ),
  };
  const renderer = new EmailRendererService(config as unknown as ConfigService);

  it('renders branded email HTML with public logo assets and text fallback', () => {
    const output = renderer.render({
      title: 'Appointment confirmed',
      subtitle: 'Notary Day · Booking confirmation',
      greeting: 'Hi Marcus,',
      intro: 'Your appointment is confirmed.',
      contentHtml: renderer.detailBlock([['Address', '2201 E Century Blvd']]),
      plainText: 'Your appointment is confirmed.',
    });

    expect(output.html).toContain(
      'https://assets.example.com/branding/notaryday-white-text.png',
    );
    expect(output.html).toContain('Appointment confirmed');
    expect(output.text).toBe('Your appointment is confirmed.');
  });

  it('escapes values used in detail blocks', () => {
    expect(
      renderer.detailBlock([['Name', '<script>alert(1)</script>']]),
    ).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});
