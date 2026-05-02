export type User = {
  name: string
  email: string
}

export function formatUser(user: User) {
  return user.name
}
