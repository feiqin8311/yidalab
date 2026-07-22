import { readFile } from 'node:fs/promises';

import type { LobeChatDatabase } from '@lobechat/database';
import { nanoid } from '@lobechat/utils';

import { AgentSkillModel } from '@/database/models/agentSkill';
import { CompanyMarketSkillModel } from '@/database/models/companyMarketSkill';
import { FileService } from '@/server/services/file';
import { SkillImportError } from '@/server/services/skill/errors';
import { SkillParser } from '@/server/services/skill/parser';
import { SkillResourceService } from '@/server/services/skill/resource';

export class CompanyMarketSkillService {
  private readonly agentSkillModel: AgentSkillModel;
  private readonly fileService: FileService;
  private readonly marketSkillModel: CompanyMarketSkillModel;
  private readonly parser = new SkillParser();
  private readonly resourceService: SkillResourceService;

  constructor(
    db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId: string,
  ) {
    this.agentSkillModel = new AgentSkillModel(db, userId, workspaceId);
    this.fileService = new FileService(db, userId, workspaceId);
    this.marketSkillModel = new CompanyMarketSkillModel(db, workspaceId);
    this.resourceService = new SkillResourceService(db, userId, workspaceId);
  }

  install = async (identifier: string) => {
    const marketSkill = await this.marketSkillModel.findByIdentifier(identifier);
    if (!marketSkill) throw new SkillImportError('Market skill not found', 'NOT_FOUND');

    const existing = await this.agentSkillModel.findByIdentifier(identifier);
    const values = {
      content: marketSkill.content,
      description: marketSkill.description,
      // Carry market visibility into the installed skill so runtime can
      // enforce "don't dump SKILL.md to the user" when hideContent is on.
      manifest: {
        ...marketSkill.manifest,
        hideContent: marketSkill.hideContent,
      },
      name: marketSkill.name,
      resources: marketSkill.resources,
      source: 'market' as const,
      zipFileHash: marketSkill.zipFileHash,
    };

    if (existing) {
      if (existing.source !== 'market') {
        throw new SkillImportError('A custom skill already uses this identifier', 'CONFLICT');
      }

      const skill = await this.agentSkillModel.update(existing.id, values);
      return { skill, status: 'updated' as const };
    }

    const sameName = await this.agentSkillModel.findByName(marketSkill.name);
    if (sameName) {
      throw new SkillImportError('A skill with this name is already installed', 'CONFLICT');
    }

    const skill = await this.agentSkillModel.create({ ...values, identifier });
    return { skill, status: 'created' as const };
  };

  /**
   * Unpublish (delete) a company market skill and uninstall every workspace
   * member's installed copy of it.
   */
  unpublish = async (identifier: string) => {
    const marketSkill = await this.marketSkillModel.findByIdentifier(identifier);
    if (!marketSkill) throw new SkillImportError('Market skill not found', 'NOT_FOUND');

    const uninstalledCount = await this.agentSkillModel.deleteMarketInstallsInWorkspace(identifier);
    await this.marketSkillModel.delete(marketSkill.id);

    return { success: true as const, uninstalledCount };
  };

  publish = async (params: { identifier?: string; zipFileId: string }) => {
    const { cleanup, file, filePath } = await this.fileService.downloadFileToLocal(
      params.zipFileId,
    );

    try {
      if (!file.fileHash)
        throw new SkillImportError('Uploaded package is missing its file hash', 'FILE_NOT_FOUND');

      const parsed = await this.parser.parseZipPackage(await readFile(filePath));
      if (parsed.zipHash !== file.fileHash) {
        throw new SkillImportError(
          'Uploaded package hash does not match its file record',
          'CONFLICT',
        );
      }

      const resources = await this.resourceService.storeResources(parsed.zipHash, parsed.resources);
      const values = {
        content: parsed.content,
        description: parsed.manifest.description,
        manifest: parsed.manifest,
        name: parsed.manifest.name,
        publisherId: this.userId,
        resources,
        zipFileHash: parsed.zipHash,
      };

      if (params.identifier) {
        const existing = await this.marketSkillModel.findByIdentifier(params.identifier);
        if (!existing) throw new SkillImportError('Market skill not found', 'NOT_FOUND');

        return this.marketSkillModel.update(existing.id, values);
      }

      return this.marketSkillModel.create({
        ...values,
        // Default: hide SKILL.md body from non-managers / UI dumps.
        hideContent: true,
        identifier: `company.${nanoid(12)}`,
      });
    } finally {
      cleanup();
    }
  };
}
