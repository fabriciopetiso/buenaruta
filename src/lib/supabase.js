import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// ─── Auth helpers ────────────────────────────────────────────────────────────

export const signUp = async (email, password, username, moto) => {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { username } }
  })
  if (error) throw error
  if (data.user) {
    await supabase.from('profiles').update({
      username,
      moto_modelo: moto?.modelo || null,
      moto_cilindrada: moto?.cilindrada || null,
      moto_anio: moto?.anio || null
    }).eq('id', data.user.id)
  }
  return data
}

export const signIn = async (email, password) => {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data
}

export const signOut = async () => {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

export const fetchRoutes = async (limit = 50) => {
  const { data, error } = await supabase
    .from('routes')
    .select(`*, profiles:user_id (id, username, avatar_url, moto_modelo, moto_cilindrada, moto_anio), route_likes (user_id), route_comments (id, user_id, text, created_at, profiles:user_id (username))`)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data
}

export const fetchRouteById = async (id) => {
  const { data, error } = await supabase
    .from('routes')
    .select(`*, profiles:user_id (id, username, avatar_url, moto_modelo, moto_cilindrada, moto_anio), route_likes (user_id), route_comments (id, user_id, text, created_at, profiles:user_id (username))`)
    .eq('id', id).single()
  if (error) throw error
  return data
}

export const createRoute = async (route) => {
  const { data, error } = await supabase.from('routes').insert(route).select().single()
  if (error) throw error
  return data
}

export const updateRoute = async (id, updates) => {
  const { data, error } = await supabase.from('routes').update(updates).eq('id', id).select().single()
  if (error) throw error
  return data
}

export const deleteRoute = async (id) => {
  const { error } = await supabase.from('routes').delete().eq('id', id)
  if (error) throw error
}

export const toggleLike = async (routeId, userId) => {
  const { data: existing } = await supabase.from('route_likes').select().eq('route_id', routeId).eq('user_id', userId).single()
  if (existing) {
    const { error } = await supabase.from('route_likes').delete().eq('route_id', routeId).eq('user_id', userId)
    if (error) throw error
    return false
  } else {
    const { error } = await supabase.from('route_likes').insert({ route_id: routeId, user_id: userId })
    if (error) throw error
    return true
  }
}

export const addComment = async (routeId, userId, text) => {
  const { data, error } = await supabase.from('route_comments').insert({ route_id: routeId, user_id: userId, text }).select(`*, profiles:user_id (username)`).single()
  if (error) throw error
  return data
}

export const toggleFollow = async (followerId, followingId) => {
  const { data: existing } = await supabase.from('follows').select().eq('follower_id', followerId).eq('following_id', followingId).single()
  if (existing) {
    const { error } = await supabase.from('follows').delete().eq('follower_id', followerId).eq('following_id', followingId)
    if (error) throw error
    return false
  } else {
    const { error } = await supabase.from('follows').insert({ follower_id: followerId, following_id: followingId })
    if (error) throw error
    return true
  }
}

export const fetchFollowCounts = async (userId) => {
  const { count: followers } = await supabase.from('follows').select('*', { count: 'exact', head: true }).eq('following_id', userId)
  const { count: following } = await supabase.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', userId)
  return { followers: followers || 0, following: following || 0 }
}

export const checkIsFollowing = async (followerId, followingId) => {
  const { data } = await supabase.from('follows').select().eq('follower_id', followerId).eq('following_id', followingId).single()
  return !!data
}

export const fetchSavedRoutes = async (userId) => {
  const { data, error } = await supabase.from('saved_routes').select(`*, routes (*, profiles:user_id (id, username, moto_modelo))`).eq('user_id', userId).order('saved_at', { ascending: false })
  if (error) throw error
  return data
}

export const toggleSaveRoute = async (userId, routeId) => {
  const { data: existing } = await supabase.from('saved_routes').select().eq('user_id', userId).eq('route_id', routeId).single()
  if (existing) {
    const { error } = await supabase.from('saved_routes').delete().eq('user_id', userId).eq('route_id', routeId)
    if (error) throw error
    return null
  } else {
    const { data, error } = await supabase.from('saved_routes').insert({ user_id: userId, route_id: routeId }).select().single()
    if (error) throw error
    return data
  }
}

export const updateSavedRouteStatus = async (userId, routeId, status) => {
  const { error } = await supabase.from('saved_routes').update({ status, completed_at: status === 'completed' ? new Date().toISOString() : null }).eq('user_id', userId).eq('route_id', routeId)
  if (error) throw error
}

export const fetchProfile = async (userId) => {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single()
  if (error) throw error
  return data
}

export const updateProfile = async (userId, updates) => {
  const { data, error } = await supabase.from('profiles').update(updates).eq('id', userId).select().single()
  if (error) throw error
  return data
}

export const uploadAvatar = async (userId, file) => {
  const ext = file.name.split('.').pop();
  const path = `${userId}.${ext}`;
  const { error } = await supabase.storage.from('avatars').upload(path, file, { upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  return data.publicUrl;
}

export const uploadRoutePhoto = async (userId, file) => {
  const ext = file.name.split('.').pop();
  const path = `${userId}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from('route-photos').upload(path, file, { upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from('route-photos').getPublicUrl(path);
  return data.publicUrl;
}

export const fetchUserRoutes = async (userId) => {
  const { data, error } = await supabase.from('routes').select(`*, profiles:user_id (id, username, moto_modelo), route_likes (user_id), route_comments (id)`).eq('user_id', userId).order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export const subscribeToRoutes = (callback) => {
  return supabase.channel('routes-channel').on('postgres_changes', { event: '*', schema: 'public', table: 'routes' }, callback).subscribe()
}

export const subscribeToLikes = (callback) => {
  return supabase.channel('likes-channel').on('postgres_changes', { event: '*', schema: 'public', table: 'route_likes' }, callback).subscribe()
}

export const subscribeToComments = (callback) => {
  return supabase.channel('comments-channel').on('postgres_changes', { event: '*', schema: 'public', table: 'route_comments' }, callback).subscribe()
}
