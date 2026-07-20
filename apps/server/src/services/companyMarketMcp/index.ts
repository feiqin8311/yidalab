import type { LobeChatDatabase } from '@lobechat/database';
import { nanoid } from '@lobechat/utils';

import { CompanyMarketMcpModel } from '@/database/models/companyMarketMcp';
import type { CompanyMarketMcpConnection } from '@/database/schemas/companyMarketMcp';

export class CompanyMarketMcpService {
  private readonly marketMcpModel: CompanyMarketMcpModel;

  constructor(
    db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId: string,
  ) {
    this.marketMcpModel = new CompanyMarketMcpModel(db, workspaceId);
  }

  create = async (params: {
    category?: string;
    connection: CompanyMarketMcpConnection;
    description: string;
    icon?: string;
    identifier?: string;
    name: string;
    tags?: string[];
  }) => {
    return this.marketMcpModel.create({
      category: params.category,
      connection: params.connection,
      description: params.description,
      icon: params.icon,
      identifier: params.identifier || `company.mcp.${nanoid(12)}`,
      name: params.name,
      publisherId: this.userId,
      tags: params.tags || [],
    });
  };
}
