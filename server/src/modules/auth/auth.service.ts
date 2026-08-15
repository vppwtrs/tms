import bcrypt from 'bcryptjs'
import { SignJWT } from 'jose'
import { config } from '../../config.js'
import { err } from '../../core/errors.js'
import { AuthRepository } from './auth.repository.js'
import type { Role } from '../../core/constants.js'
import { effectivePermissions, isPermission, type Permission } from '../../core/permissions.js'

const secret = new TextEncoder().encode(config.jwtSecret)

export interface AuthUser {
  id: number
  username: string
  name: string
  role: string
}

/** ผู้ใช้ 1 คนพร้อมสิทธิ์ที่ใช้จริง — หน้าจัดการผู้ใช้ใช้ก้อนนี้ทั้งหมด */
export interface UserWithPermissions {
  id: number
  username: string
  name: string
  role: Role
  is_active: boolean
  created_at: string
  /** สิทธิ์ที่ใช้จริง = preset ของบทบาท ปรับด้วย overrides */
  permissions: Permission[]
  /** เฉพาะรายการที่ admin ตั้งต่างจาก preset — หน้าจอเอาไปแสดงป้าย "ปรับเอง" */
  overrides: Record<string, boolean>
}

export class AuthService {
  constructor(private readonly repo: AuthRepository) {}

  async login(username: string, password: string): Promise<{ token: string; user: AuthUser }> {
    const user = this.repo.findByUsername(username.trim())
    if (!user) throw err.unauthorized('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง')
    const ok = await bcrypt.compare(password, user.password_hash)
    if (!ok) throw err.unauthorized('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง')
    /* ข้อความต่างจากด้านบนโดยตั้งใจ — รหัสผ่านถูกแล้ว บอกสาเหตุจริงได้ ไม่ใช่การเดาบัญชี */
    if (user.is_active !== 1) throw err.forbidden('บัญชีนี้ถูกปิดการใช้งาน ติดต่อผู้ดูแลระบบ')

    const token = await new SignJWT({
      username: user.username,
      name: user.name,
      role: user.role,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(String(user.id))
      .setIssuedAt()
      .setExpirationTime(config.jwtTtl)
      .sign(secret)

    return { token, user: this.publicUser(user.id) }
  }

  me(id: number): AuthUser & { permissions: Permission[] } {
    return this.publicUser(id)
  }

  /** ก้อนข้อมูลผู้ใช้ที่ frontend ใช้ — มีสิทธิ์ติดมาด้วยเสมอ ไม่ต้องยิง API ซ้ำ */
  private publicUser(id: number): AuthUser & { permissions: Permission[] } {
    const u = this.repo.findById(id)
    if (!u) throw err.unauthorized()
    const overrides = Object.fromEntries(
      this.repo.listOverrides(u.id).map((r) => [r.permission, r.allowed === 1]),
    )
    return {
      id: u.id,
      username: u.username,
      name: u.name,
      role: u.role,
      permissions: effectivePermissions(u.role, overrides),
    }
  }

  async changePassword(id: number, oldPassword: string, newPassword: string): Promise<void> {
    const user = this.repo.findById(id)
    if (!user) throw err.unauthorized()
    const ok = await bcrypt.compare(oldPassword, user.password_hash)
    if (!ok) throw err.badRequest('รหัสผ่านเดิมไม่ถูกต้อง')
    if (newPassword.length < 6) throw err.badRequest('รหัสผ่านใหม่ต้องยาวอย่างน้อย 6 ตัวอักษร')
    const hash = await bcrypt.hash(newPassword, config.bcryptRounds)
    this.repo.updatePassword(id, hash)
  }

  listUsers(): UserWithPermissions[] {
    return this.repo.listUsers().map((u) => this.withPermissions(u))
  }

  getUser(id: number): UserWithPermissions {
    const u = this.repo.findById(id)
    if (!u) throw err.notFound('ไม่พบผู้ใช้')
    return this.withPermissions(u)
  }

  private withPermissions(u: {
    id: number
    username: string
    name: string
    role: Role
    is_active: number
    created_at: string
  }): UserWithPermissions {
    const overrides = Object.fromEntries(
      this.repo.listOverrides(u.id).map((r) => [r.permission, r.allowed === 1]),
    )
    return {
      id: u.id,
      username: u.username,
      name: u.name,
      role: u.role,
      is_active: u.is_active === 1,
      created_at: u.created_at,
      permissions: effectivePermissions(u.role, overrides),
      overrides,
    }
  }

  async createUser(data: { username: string; password: string; name: string; role: string }): Promise<number> {
    const username = data.username.trim().toLowerCase()
    if (this.repo.findByUsername(username)) throw err.conflict('ชื่อผู้ใช้ซ้ำในระบบ')
    const hash = await bcrypt.hash(data.password, config.bcryptRounds)
    return this.repo.createUser({ username, password_hash: hash, name: data.name, role: data.role as Role })
  }

  updateUser(id: number, data: { name: string; role: Role }): void {
    const target = this.repo.findById(id)
    if (!target) throw err.notFound('ไม่พบผู้ใช้')
    /* ถอดผู้ดูแลคนสุดท้ายออกจากบทบาท admin ไม่ได้ — ระบบจะไม่เหลือคนแจกสิทธิ์ */
    if (target.role === 'admin' && data.role !== 'admin' && this.repo.countActiveAdmins() <= 1) {
      throw err.badRequest('ต้องมีผู้ดูแลระบบที่เปิดใช้งานอย่างน้อย 1 คน')
    }
    this.repo.updateUser(id, data)
  }

  setActive(id: number, active: boolean, actorId: number): void {
    const target = this.repo.findById(id)
    if (!target) throw err.notFound('ไม่พบผู้ใช้')
    if (id === actorId && !active) throw err.badRequest('ปิดบัญชีของตัวเองไม่ได้')
    if (!active && target.role === 'admin' && this.repo.countActiveAdmins() <= 1) {
      throw err.badRequest('ต้องมีผู้ดูแลระบบที่เปิดใช้งานอย่างน้อย 1 คน')
    }
    this.repo.setActive(id, active)
  }

  async resetPassword(id: number, newPassword: string): Promise<void> {
    if (!this.repo.findById(id)) throw err.notFound('ไม่พบผู้ใช้')
    if (newPassword.length < 6) throw err.badRequest('รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร')
    this.repo.updatePassword(id, await bcrypt.hash(newPassword, config.bcryptRounds))
  }

  deleteUser(id: number, actorId: number): void {
    const target = this.repo.findById(id)
    if (!target) throw err.notFound('ไม่พบผู้ใช้')
    if (id === actorId) throw err.badRequest('ลบบัญชีของตัวเองไม่ได้')
    if (target.role === 'admin' && this.repo.countActiveAdmins() <= 1) {
      throw err.badRequest('ต้องมีผู้ดูแลระบบที่เปิดใช้งานอย่างน้อย 1 คน')
    }
    /* POD ผูกกับคนเก็บแบบ NOT NULL เพราะเป็นหลักฐานทางเอกสาร ลบคนเก็บทิ้งไม่ได้
       เดิมเคสนี้ตกไปถึง FK ของ SQLite แล้วเด้ง "ข้อมูลนี้ถูกใช้งานอยู่" ลอย ๆ
       ซึ่งไม่บอกว่าติดที่อะไรและต้องทำยังไงต่อ */
    const podCount = this.repo.countPodCollected(id)
    if (podCount > 0) {
      throw err.badRequest(
        `บัญชี ${target.username} เก็บหลักฐานการส่งมอบไว้ ${podCount} รายการ จึงลบถาวรไม่ได้ — ให้ "ปิดบัญชี" แทน บัญชีที่ปิดแล้วล็อกอินไม่ได้และไม่ได้รับงานใหม่`,
      )
    }
    this.repo.deleteUser(id)
  }

  /** บันทึกสิทธิ์รายคน — รับ "สิทธิ์ที่ต้องการให้มี" ทั้งชุด แล้วเก็บเฉพาะส่วนที่ต่างจาก preset
   *  เก็บส่วนต่างแทนที่จะเก็บทั้งชุด เพื่อให้เปลี่ยนบทบาททีหลังแล้วยังได้ preset ใหม่ตามจริง */
  setPermissions(id: number, wanted: string[], actorId: number): UserWithPermissions {
    const target = this.repo.findById(id)
    if (!target) throw err.notFound('ไม่พบผู้ใช้')
    const invalid = wanted.filter((p) => !isPermission(p))
    if (invalid.length > 0) throw err.badRequest(`สิทธิ์ไม่ถูกต้อง: ${invalid.join(', ')}`)

    const want = new Set(wanted)
    if (id === actorId && !want.has('users.manage')) {
      throw err.badRequest('ถอนสิทธิ์จัดการผู้ใช้ของตัวเองไม่ได้ — จะกลับเข้ามาแก้ไม่ได้อีก')
    }

    const preset = new Set(effectivePermissions(target.role, {}))
    const diff = [...new Set([...preset, ...want])]
      .filter((p) => preset.has(p as Permission) !== want.has(p))
      .map((p) => ({ permission: p, allowed: want.has(p) }))

    this.repo.replaceOverrides(id, diff)
    return this.getUser(id)
  }
}
