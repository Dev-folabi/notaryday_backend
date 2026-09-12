import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  EmailProvider,
  EmailProviderDocument,
} from '../schemas/provider.schema';
import { EncryptionService } from '../encryption/encryption.service';
import { MailerFactory } from '../mailer/mailer.factory';
import { PROVIDER_CREDENTIAL_KEYS, ProviderType } from '../marketing.constants';
import { CreateProviderDto } from '../dto/create-provider.dto';
import { UpdateProviderDto } from '../dto/update-provider.dto';
import { TestProviderDto } from '../dto/test-provider.dto';

export interface SafeProvider {
  _id: Types.ObjectId;
  name: string;
  type: string;
  fromName: string;
  fromEmail: string;
  replyTo?: string;
  perMinuteLimit: number;
  dailyLimit: number;
  status: string;
  isDefault: boolean;
  warmupEnabled: boolean;
  warmupStartedAt?: Date;
  warmupCurrentDaily: number;
  healthLastError?: string | null;
  healthLastErrorAt?: Date | null;
  healthLastSuccessAt?: Date | null;
  sentToday: number;
  sentTodayDate?: string | null;
  notes?: string | null;
  credentialsSet: string[];
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class ProvidersService {
  private readonly logger = new Logger(ProvidersService.name);

  constructor(
    @InjectModel(EmailProvider.name)
    private readonly providerModel: Model<EmailProviderDocument>,
    private readonly encryption: EncryptionService,
    private readonly mailerFactory: MailerFactory,
  ) {}

  private toSafe(doc: EmailProviderDocument): SafeProvider {
    const { credentialsEncrypted, ...rest } = doc.toObject();
    let credentialsSet: string[] = [];
    try {
      credentialsSet = Object.keys(
        this.encryption.decrypt(credentialsEncrypted),
      );
    } catch {
      credentialsSet = [];
    }
    return { ...rest, credentialsSet } as unknown as SafeProvider;
  }

  async findAll(): Promise<SafeProvider[]> {
    const docs = await this.providerModel.find().sort({ createdAt: 1 }).exec();
    return docs.map((d) => this.toSafe(d));
  }

  async findOne(id: string): Promise<SafeProvider> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Provider not found');
    }
    const doc = await this.providerModel.findById(id).exec();
    if (!doc) throw new NotFoundException('Provider not found');
    return this.toSafe(doc);
  }

  private validateCredentials(
    type: ProviderType,
    credentials: Record<string, string>,
  ) {
    const required = PROVIDER_CREDENTIAL_KEYS[type] ?? [];
    const missing = required.filter((key) => !credentials[key]?.trim());
    if (missing.length > 0) {
      throw new BadRequestException(
        `Provider type "${type}" requires credentials: ${required.join(', ')} (missing: ${missing.join(', ')})`,
      );
    }
  }

  async create(dto: CreateProviderDto): Promise<SafeProvider> {
    this.validateCredentials(dto.type as ProviderType, dto.credentials);

    // Only one default provider at a time
    if (dto.isDefault) {
      await this.providerModel.updateMany({}, { $set: { isDefault: false } });
    }

    const doc = await this.providerModel.create({
      name: dto.name,
      type: dto.type,
      fromName: dto.fromName,
      fromEmail: dto.fromEmail.toLowerCase(),
      replyTo: dto.replyTo?.toLowerCase(),
      credentialsEncrypted: this.encryption.encrypt(dto.credentials),
      perMinuteLimit: dto.perMinuteLimit ?? 30,
      dailyLimit: dto.dailyLimit ?? 100,
      warmupEnabled: dto.warmupEnabled ?? false,
      warmupStartedAt: dto.warmupEnabled ? new Date() : undefined,
      isDefault: dto.isDefault ?? false,
      notes: dto.notes,
    });
    this.logger.log(`Created email provider "${doc.name}" (${doc.type})`);
    return this.toSafe(doc);
  }

  async update(id: string, dto: UpdateProviderDto): Promise<SafeProvider> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Provider not found');
    }
    const doc = await this.providerModel.findById(id).exec();
    if (!doc) throw new NotFoundException('Provider not found');

    const update: Record<string, unknown> = {};
    if (dto.name !== undefined) update.name = dto.name;
    if (dto.type !== undefined) update.type = dto.type;
    if (dto.fromName !== undefined) update.fromName = dto.fromName;
    if (dto.fromEmail !== undefined)
      update.fromEmail = dto.fromEmail.toLowerCase();
    if (dto.replyTo !== undefined)
      update.replyTo = dto.replyTo.toLowerCase() || undefined;
    if (dto.perMinuteLimit !== undefined)
      update.perMinuteLimit = dto.perMinuteLimit;
    if (dto.dailyLimit !== undefined) update.dailyLimit = dto.dailyLimit;
    if (dto.status !== undefined) update.status = dto.status;
    if (dto.warmupEnabled !== undefined) {
      update.warmupEnabled = dto.warmupEnabled;
      if (dto.warmupEnabled && !doc.warmupStartedAt) {
        update.warmupStartedAt = new Date();
      }
    }
    if (dto.isDefault !== undefined) update.isDefault = dto.isDefault;
    if (dto.notes !== undefined) update.notes = dto.notes;

    if (dto.credentials !== undefined) {
      const merged = {
        ...this.encryption.decrypt<Record<string, string>>(
          doc.credentialsEncrypted,
        ),
        ...Object.fromEntries(
          Object.entries(dto.credentials).filter(([, v]) => v !== undefined),
        ),
      };
      const type = (dto.type ?? doc.type) as ProviderType;
      this.validateCredentials(type, merged);
      update.credentialsEncrypted = this.encryption.encrypt(merged);
    }

    if (dto.isDefault === true) {
      await this.providerModel.updateMany(
        { _id: { $ne: doc._id } },
        { $set: { isDefault: false } },
      );
    }

    const updated = await this.providerModel
      .findByIdAndUpdate(doc._id, { $set: update }, { new: true })
      .exec();
    return this.toSafe(updated!);
  }

  async remove(id: string): Promise<{ deleted: true }> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Provider not found');
    }
    const doc = await this.providerModel.findByIdAndDelete(id).exec();
    if (!doc) throw new NotFoundException('Provider not found');
    return { deleted: true };
  }

  /**
   * Sends a test email synchronously via the provider (used by the admin UI).
   * Updates provider health on success/failure.
   */
  async sendTest(id: string, dto: TestProviderDto): Promise<{ sent: true }> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Provider not found');
    }
    const doc = await this.providerModel.findById(id).exec();
    if (!doc) throw new NotFoundException('Provider not found');

    let credentials: Record<string, string>;
    try {
      credentials = this.encryption.decrypt<Record<string, string>>(
        doc.credentialsEncrypted,
      );
    } catch {
      throw new BadRequestException(
        'Stored credentials could not be decrypted — was MARKETING_CREDENTIALS_KEY changed? Re-enter credentials.',
      );
    }

    const mailer = this.mailerFactory.build(
      doc.type as ProviderType,
      credentials,
    );
    const text =
      dto.text ??
      'This is a test email sent from the NotaryDay admin console marketing module.';
    try {
      const result = await mailer.send({
        to: dto.to,
        subject: dto.subject ?? 'NotaryDay marketing provider test',
        text,
        html: `<p>${text}</p>`,
        fromName: doc.fromName,
        fromEmail: doc.fromEmail,
        replyTo: doc.replyTo || undefined,
      });
      await this.providerModel
        .updateOne(
          { _id: doc._id },
          {
            $set: {
              healthLastSuccessAt: new Date(),
              healthLastError: null,
              healthLastErrorAt: null,
            },
          },
        )
        .exec();
      this.logger.log(
        `Test email via provider "${doc.name}" -> ${dto.to} (id=${result.providerMessageId ?? 'n/a'})`,
      );
      return { sent: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.providerModel
        .updateOne(
          { _id: doc._id },
          {
            $set: {
              healthLastError: message.slice(0, 500),
              healthLastErrorAt: new Date(),
            },
          },
        )
        .exec();
      throw new BadRequestException(
        `Test send failed via ${doc.type}: ${message}`,
      );
    }
  }
}
