import { SettingsRepository, type SettingsRow } from './settings.repository.js'

export class SettingsService {
  constructor(private readonly repo: SettingsRepository) {}

  get(): SettingsRow {
    return this.repo.getAll()
  }

  update(data: Partial<SettingsRow>): SettingsRow {
    if (data.org_name !== undefined) this.repo.set('org_name', data.org_name.trim())
    if (data.currency_code !== undefined) this.repo.set('currency_code', data.currency_code.trim().toUpperCase())
    if (data.currency_symbol !== undefined) this.repo.set('currency_symbol', data.currency_symbol.trim())
    return this.repo.getAll()
  }
}
